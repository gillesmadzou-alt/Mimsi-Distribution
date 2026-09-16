import { createClient } from "jsr:@supabase/supabase-js@2";

// Logique partagée du bot conversationnel (mode "conversational" de
// auto_reply_settings) : historique par conversation (bot_conversations +
// bot_messages) et appel au LLM (Anthropic Claude) pour générer une
// réponse. Utilisé par meta-webhook.
//
// Config requise (Supabase secrets) :
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optionnel : ANTHROPIC_MODEL (défaut : claude-haiku-4-5-20251001, choisi
// pour son coût réduit — adapté à un usage à fort volume comme un bot de
// service client ; changez-le si vous préférez un modèle plus capable).

type Channel = "whatsapp" | "facebook" | "instagram";
type ServiceClient = ReturnType<typeof createClient>;

export interface BotConversation {
  id: string;
  bot_active: boolean;
}

// Récupère (ou crée) la conversation suivie pour ce client sur ce canal.
export async function getOrCreateConversation(
  serviceClient: ServiceClient,
  channel: Channel,
  customerPhone: string,
): Promise<BotConversation | null> {
  const { data: existing } = await serviceClient
    .from("bot_conversations")
    .select("id, bot_active")
    .eq("channel", channel)
    .eq("customer_phone", customerPhone)
    .maybeSingle();
  if (existing) return existing as BotConversation;

  const { data: created, error } = await serviceClient
    .from("bot_conversations")
    .insert({ channel, customer_phone: customerPhone })
    .select("id, bot_active")
    .maybeSingle();
  if (error) {
    console.error("bot.getOrCreateConversation insert error:", error.message);
    return null;
  }
  return created as BotConversation | null;
}

// Désactive le bot pour ce fil : appelé quand un membre de l'équipe répond
// manuellement au client (voir send-facebook-message). C'est la règle de
// handoff bot -> humain : simple, sans écran de configuration dédié.
export async function deactivateBotForCustomer(
  serviceClient: ServiceClient,
  channel: Channel,
  customerPhone: string,
) {
  const { error } = await serviceClient
    .from("bot_conversations")
    .upsert(
      { channel, customer_phone: customerPhone, bot_active: false },
      { onConflict: "channel,customer_phone" },
    );
  if (error) console.error("bot.deactivateBotForCustomer error:", error.message);
}

export async function recordMessage(
  serviceClient: ServiceClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  usage?: { inputTokens: number; outputTokens: number },
) {
  const { error } = await serviceClient.from("bot_messages").insert({
    conversation_id: conversationId,
    role,
    content,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
  });
  if (error) console.error("bot.recordMessage error:", error.message);
  await serviceClient
    .from("bot_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
}

const DEFAULT_SYSTEM_PROMPT =
  "Tu es l'assistant virtuel de Mimsi Distribution. Réponds brièvement et " +
  "poliment en français. Utilise les outils disponibles pour toute question " +
  "sur les prix, les produits ou les zones de livraison — ne devine jamais " +
  "ces informations. Si une question sort de ce que les outils couvrent " +
  "(stock exact, délai précis, cas particulier), dis clairement que tu ne " +
  "sais pas et propose de transmettre la question à l'équipe plutôt que " +
  "d'inventer une réponse.";

// Outils en lecture seule exposés au bot : uniquement des données déjà
// publiques par nature (catalogue, zones desservies). Jamais de données
// client/personnel/financières, même si serviceClient (service_role) a
// techniquement accès à tout — on sélectionne explicitement les colonnes
// sûres à divulguer à n'importe quel client sur WhatsApp/Facebook/Instagram.
const BOT_TOOLS = [
  {
    name: "get_product_catalog",
    description:
      "Retourne la liste des produits actifs de Mimsi Distribution (pots de madeleines) avec leur prix en FCFA. " +
      "À utiliser pour toute question sur les prix ou les produits disponibles.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_delivery_zones",
    description:
      "Retourne les zones et quartiers actuellement desservis par Mimsi Distribution, d'après les points de vente actifs. " +
      "À utiliser pour toute question sur les zones ou quartiers de livraison couverts.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
] as const;

async function toolGetProductCatalog(serviceClient: ServiceClient): Promise<string> {
  const { data, error } = await serviceClient
    .from("pot_types")
    .select("name, shape, unit_price_fcfa, madeleine_count")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("bot tool get_product_catalog error:", error.message);
    return JSON.stringify({ error: "Catalogue indisponible pour le moment." });
  }
  return JSON.stringify({
    produits: (data ?? []).map((p) => ({
      nom: p.name,
      forme: p.shape,
      prix_fcfa: p.unit_price_fcfa,
      madeleines_par_pot: p.madeleine_count,
    })),
  });
}

async function toolGetDeliveryZones(serviceClient: ServiceClient): Promise<string> {
  const { data, error } = await serviceClient
    .from("sales_points")
    .select("zone, district")
    .eq("is_active", true);
  if (error) {
    console.error("bot tool get_delivery_zones error:", error.message);
    return JSON.stringify({ error: "Zones indisponibles pour le moment." });
  }
  const zones = [...new Set((data ?? []).map((p) => (p.zone as string)?.trim()).filter(Boolean))].sort();
  const quartiers = [...new Set((data ?? []).map((p) => (p.district as string)?.trim()).filter(Boolean))].sort();
  return JSON.stringify({ zones, quartiers });
}

async function runBotTool(serviceClient: ServiceClient, name: string): Promise<string> {
  switch (name) {
    case "get_product_catalog": return await toolGetProductCatalog(serviceClient);
    case "get_delivery_zones": return await toolGetDeliveryZones(serviceClient);
    default: return JSON.stringify({ error: `Outil inconnu : ${name}` });
  }
}

export interface BotReply {
  ok: true;
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface BotReplyError {
  ok: false;
  error: string;
}

// Récupère les N derniers messages de la conversation (ordre chronologique)
// pour servir de contexte au LLM.
async function loadHistory(serviceClient: ServiceClient, conversationId: string, limit = 20) {
  const { data } = await serviceClient
    .from("bot_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as { role: "user" | "assistant"; content: string }[] | null) ?? [])
    .reverse();
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// Nombre max d'allers-retours outil -> LLM avant d'abandonner : garde-fou
// contre une boucle d'appels d'outils qui ne convergerait jamais vers une
// réponse texte (protège le coût et le temps de réponse du webhook).
const MAX_TOOL_ROUNDS = 4;

export async function generateBotReply(
  serviceClient: ServiceClient,
  conversationId: string,
  systemPrompt: string | null,
): Promise<BotReply | BotReplyError> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY non configuré côté Supabase." };
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";

  const history = await loadHistory(serviceClient, conversationId);
  if (history.length === 0) return { ok: false, error: "Aucun historique à répondre." };

  // Historique initial = texte simple. Les allers-retours d'outils ci-dessous
  // y ajoutent temporairement des messages à contenu structuré (tool_use /
  // tool_result) — jamais persistés dans bot_messages, seule la réponse
  // texte finale l'est (via l'appelant, voir meta-webhook).
  const messages: {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[] | AnthropicToolResultBlock[];
  }[] = history.map((m) => ({ role: m.role, content: m.content }));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
        messages,
        tools: BOT_TOOLS,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API Anthropic.";
      return { ok: false, error: `Anthropic a refusé la requête : ${message}` };
    }

    const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
    totalInputTokens += usage?.input_tokens ?? 0;
    totalOutputTokens += usage?.output_tokens ?? 0;

    const content = (data as { content?: AnthropicContentBlock[] })?.content ?? [];
    const stopReason = (data as { stop_reason?: string }).stop_reason;

    if (stopReason === "tool_use") {
      messages.push({ role: "assistant", content });

      const toolResults: AnthropicToolResultBlock[] = [];
      for (const block of content) {
        if (block.type !== "tool_use" || !block.id || !block.name) continue;
        let resultText: string;
        try {
          resultText = await runBotTool(serviceClient, block.name);
        } catch (err) {
          resultText = JSON.stringify({ error: "Erreur interne lors de l'exécution de l'outil." });
          console.error("bot tool execution error:", block.name, err);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!text) return { ok: false, error: "Réponse vide du LLM." };

    return { ok: true, text, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
  }

  return { ok: false, error: "Trop d'appels d'outils enchaînés sans réponse finale." };
}
