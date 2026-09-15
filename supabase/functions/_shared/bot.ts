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
  "poliment en français. Si tu ne connais pas la réponse (prix exact, " +
  "stock, délai précis), dis clairement que tu ne sais pas et propose de " +
  "transmettre la question à l'équipe plutôt que d'inventer une réponse.";

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API Anthropic.";
    return { ok: false, error: `Anthropic a refusé la requête : ${message}` };
  }

  const text = ((data as { content?: { type: string; text?: string }[] })?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) return { ok: false, error: "Réponse vide du LLM." };

  const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
  return {
    ok: true,
    text,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}
