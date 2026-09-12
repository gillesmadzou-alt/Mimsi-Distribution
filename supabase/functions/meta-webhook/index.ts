import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendChannelMessage } from "../_shared/messaging.ts";

// Remplace le webhook n8n : reçoit DIRECTEMENT les évènements Meta (WhatsApp
// Business, Messenger, Instagram, commentaires sur la Page) et les
// enregistre dans `marketing_orders` (messages) ou `facebook_comments`
// (commentaires). Un seul point d'entrée pour les 3 plateformes, pointé
// depuis "URL de rappel" dans Meta for Developers > Cas d'utilisation >
// [plateforme] > Personnaliser > Configurer des webhooks.
//
// Config requise (Supabase secrets) :
//   supabase secrets set META_VERIFY_TOKEN=<le même token que dans Meta>
//
// GET  : poignée de main de vérification Meta (répond hub.challenge).
// POST : évènements entrants — messages (marketing_orders) et commentaires
//        de Page (facebook_comments). Les réponses/actions de modération se
//        font via les fonctions send-facebook-message et
//        manage-facebook-comment (appelées depuis l'app, pas ici).

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function textResponse(body: string, status: number) {
  return new Response(body, { status, headers: { ...corsHeaders(), "Content-Type": "text/plain" } });
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

type NormalizedMessage = {
  channel: "whatsapp" | "facebook" | "instagram";
  customerName: string | null;
  customerPhone: string | null;
  message: string | null;
  externalId: string | null;
  rawPayload: Record<string, unknown>;
};

type NormalizedComment = {
  postId: string | null;
  commentId: string;
  parentCommentId: string | null;
  fromId: string | null;
  fromName: string | null;
  message: string | null;
  createdTime: string | null;
  rawPayload: Record<string, unknown>;
};

// Extrait le texte utilisable d'un message WhatsApp, quel que soit son type.
function extractWhatsappText(msg: Record<string, unknown>): string | null {
  const type = msg.type as string | undefined;
  if (type === "text") return (msg.text as { body?: string } | undefined)?.body ?? null;
  if (type === "button") return (msg.button as { text?: string } | undefined)?.text ?? null;
  if (type === "interactive") {
    const interactive = msg.interactive as Record<string, unknown> | undefined;
    return (
      (interactive?.button_reply as { title?: string } | undefined)?.title ??
      (interactive?.list_reply as { title?: string } | undefined)?.title ??
      null
    );
  }
  if (type) return `[message de type ${type}]`;
  return null;
}

// Un même évènement Meta ("entry") peut regrouper WhatsApp, Messenger et
// Instagram selon la valeur du champ "object" à la racine du webhook.
function normalizeEntries(body: Record<string, unknown>): NormalizedMessage[] {
  const object = body.object as string | undefined;
  const entries = (body.entry as Record<string, unknown>[] | undefined) ?? [];
  const results: NormalizedMessage[] = [];

  if (object === "whatsapp_business_account") {
    for (const entry of entries) {
      const changes = (entry.changes as Record<string, unknown>[] | undefined) ?? [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = (change.value as Record<string, unknown>) ?? {};
        const messages = (value.messages as Record<string, unknown>[] | undefined) ?? [];
        const contacts = (value.contacts as Record<string, unknown>[] | undefined) ?? [];
        for (const msg of messages) {
          const from = msg.from as string | undefined;
          const contact = contacts.find(
            (c) => (c.wa_id as string | undefined) === from,
          ) as Record<string, unknown> | undefined;
          const profile = contact?.profile as { name?: string } | undefined;
          results.push({
            channel: "whatsapp",
            customerName: profile?.name ?? null,
            customerPhone: from ?? null,
            message: extractWhatsappText(msg),
            externalId: (msg.id as string | undefined) ?? null,
            rawPayload: msg,
          });
        }
        // Les accusés de statut (delivered/read) n'ont pas de "messages" à
        // traiter : on les ignore silencieusement (pas d'erreur, rien à
        // enregistrer).
      }
    }
    return results;
  }

  if (object === "page" || object === "instagram") {
    const channel: "facebook" | "instagram" = object === "page" ? "facebook" : "instagram";
    for (const entry of entries) {
      const messaging = (entry.messaging as Record<string, unknown>[] | undefined) ?? [];
      for (const event of messaging) {
        const message = event.message as Record<string, unknown> | undefined;
        if (!message || message.is_echo) continue; // ignore les messages envoyés par la Page elle-même
        const sender = event.sender as { id?: string } | undefined;
        results.push({
          channel,
          customerName: null, // nécessiterait un appel Graph API supplémentaire (profil PSID/IGSID)
          customerPhone: sender?.id ?? null, // PSID/IGSID, pas un numéro — sert d'identifiant pour répondre
          message: (message.text as string | undefined) ?? null,
          externalId: (message.mid as string | undefined) ?? null,
          rawPayload: event,
        });
      }
    }
    return results;
  }

  return results;
}

// Les commentaires sur les publications de la Page ("feed") arrivent dans le
// même webhook que les messages Messenger (object === "page"), mais dans
// entry.changes plutôt que entry.messaging, et vont dans une table à part
// (facebook_comments), pas marketing_orders.
function normalizeCommentEntries(body: Record<string, unknown>): NormalizedComment[] {
  if (body.object !== "page") return [];
  const entries = (body.entry as Record<string, unknown>[] | undefined) ?? [];
  const results: NormalizedComment[] = [];

  for (const entry of entries) {
    const changes = (entry.changes as Record<string, unknown>[] | undefined) ?? [];
    for (const change of changes) {
      if (change.field !== "feed") continue;
      const value = (change.value as Record<string, unknown>) ?? {};
      if (value.item !== "comment") continue;
      if (value.verb === "remove") continue; // suppression déjà reflétée par l'action de modération elle-même
      const commentId = value.comment_id as string | undefined;
      if (!commentId) continue;
      results.push({
        postId: (value.post_id as string | undefined) ?? null,
        commentId,
        parentCommentId: (value.parent_id as string | undefined) ?? null,
        fromId: (value.from as { id?: string } | undefined)?.id ?? (value.sender_id as string | undefined) ?? null,
        fromName: (value.from as { name?: string } | undefined)?.name ?? null,
        message: (value.message as string | undefined) ?? null,
        createdTime: value.created_time
          ? new Date(Number(value.created_time) * 1000).toISOString()
          : null,
        rawPayload: value,
      });
    }
  }
  return results;
}

// Envoie le message de bienvenue configuré pour ce canal (auto_reply_settings),
// mais seulement si c'est la toute première fois qu'on entend parler de ce
// client sur ce canal — évite de spammer une conversation déjà en cours.
async function maybeSendAutoReply(
  serviceClient: ReturnType<typeof createClient>,
  channel: "whatsapp" | "facebook" | "instagram",
  customerPhone: string,
) {
  try {
    const { count } = await serviceClient
      .from("marketing_orders")
      .select("id", { count: "exact", head: true })
      .eq("channel", channel)
      .eq("customer_phone", customerPhone);
    if ((count ?? 0) > 1) return; // déjà un historique avec ce client sur ce canal

    const { data: settings } = await serviceClient
      .from("auto_reply_settings")
      .select("enabled, message")
      .eq("channel", channel)
      .maybeSingle();
    if (!settings?.enabled || !settings.message) return;

    const result = await sendChannelMessage(channel, customerPhone, settings.message);
    if (!result.ok) console.error(`meta-webhook auto-reply (${channel}) error:`, result.error);
  } catch (err) {
    console.error("meta-webhook auto-reply unexpected error:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(req.url);

  // --- Poignée de main de vérification (Meta appelle en GET une seule fois
  // à chaque (ré)enregistrement de l'URL de rappel) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const expectedToken = Deno.env.get("META_VERIFY_TOKEN");
    if (!expectedToken) {
      console.error("META_VERIFY_TOKEN n'est pas configuré côté serveur.");
      return textResponse("Webhook non configuré côté serveur.", 500);
    }

    if (mode === "subscribe" && token === expectedToken && challenge) {
      return textResponse(challenge, 200);
    }
    return textResponse("Vérification échouée", 403);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée" }, 405);
  }

  // --- Évènements entrants ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    // Toujours répondre 200 même en cas de payload invalide, sinon Meta
    // considère le webhook en échec et réessaie en boucle.
    return jsonResponse({ received: true, error: "Corps JSON invalide ignoré" }, 200);
  }

  const normalized = normalizeEntries(body);
  const normalizedComments = normalizeCommentEntries(body);
  if (normalized.length === 0 && normalizedComments.length === 0) {
    return jsonResponse({ received: true, processed: 0 }, 200);
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let inserted = 0;
  for (const msg of normalized) {
    const { data: insertedRow, error } = await serviceClient
      .from("marketing_orders")
      .upsert(
        {
          channel: msg.channel,
          customer_name: msg.customerName,
          customer_phone: msg.customerPhone,
          message: msg.message,
          raw_payload: msg.rawPayload,
          external_id: msg.externalId,
          status: "nouveau",
        },
        msg.externalId ? { onConflict: "channel,external_id", ignoreDuplicates: true } : undefined,
      )
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("meta-webhook insert error:", error.message);
      continue;
    }
    inserted++;

    // Bot de réponse automatique : envoyé une seule fois, au tout premier
    // message d'un client sur ce canal (pas à chaque message).
    if (insertedRow && msg.customerPhone) {
      await maybeSendAutoReply(serviceClient, msg.channel, msg.customerPhone);
    }
  }

  for (const c of normalizedComments) {
    const { error } = await serviceClient
      .from("facebook_comments")
      .upsert(
        {
          post_id: c.postId,
          comment_id: c.commentId,
          parent_comment_id: c.parentCommentId,
          from_id: c.fromId,
          from_name: c.fromName,
          message: c.message,
          raw_payload: c.rawPayload,
          created_time: c.createdTime,
          status: "nouveau",
        },
        { onConflict: "comment_id", ignoreDuplicates: true },
      );
    if (error) {
      console.error("meta-webhook comment insert error:", error.message);
      continue;
    }
    inserted++;
  }

  // Toujours 200, même en cas d'erreurs partielles : Meta ne doit pas
  // réessayer indéfiniment un évènement déjà (au moins partiellement) traité.
  return jsonResponse({ received: true, processed: inserted }, 200);
});
