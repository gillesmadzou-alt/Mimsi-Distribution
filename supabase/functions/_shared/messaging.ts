// Module partage : envoi de messages sortants, quel que soit le canal.
// Utilise par send-facebook-message, meta-webhook (bot auto-reponse),
// broadcast-message et send-payment-reminders -- pour ne pas dupliquer la
// logique d'appel aux API Graph (Facebook/Instagram) et WhatsApp Cloud API.
//
// Multi-locataire : la fonction ne lit plus les jetons dans l'environnement.
// Elle recoit une `Connection` deja resolue pour l'organisation concernee
// (voir _shared/tenant.ts), ce qui rend impossible d'envoyer un message avec
// le compte d'un autre client.

import type { Connection, Platform } from "./tenant.ts";

export type OutboundChannel = Extract<Platform, "facebook" | "instagram" | "whatsapp">;

export type SendResult = { ok: true; externalId: string | null } | { ok: false; error: string };

function apiError(data: unknown, fallback: string): string {
  return (data as { error?: { message?: string } })?.error?.message ?? fallback;
}

// Messenger : API Send avec le jeton de Page de l'organisation.
async function sendViaFacebookPage(conn: Connection, recipientId: string, text: string): Promise<SendResult> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(conn.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: recipientId },
        message: { text },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: apiError(data, "Erreur inconnue de l'API Facebook.") };
  return { ok: true, externalId: (data as { message_id?: string })?.message_id ?? null };
}

// Instagram Direct : compte Instagram connecte directement a l'app (pas via
// une Page Facebook liee), ce qui donne un jeton propre a Instagram et un
// appel via graph.instagram.com plutot que graph.facebook.com.
async function sendViaInstagram(conn: Connection, recipientId: string, text: string): Promise<SendResult> {
  const res = await fetch(
    `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(conn.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: apiError(data, "Erreur inconnue de l'API Instagram.") };
  return { ok: true, externalId: (data as { message_id?: string })?.message_id ?? null };
}

// WhatsApp Cloud API : le Phone Number ID est l'identifiant externe de la
// connexion -- c'est aussi lui qui sert a router les webhooks entrants.
async function sendViaWhatsapp(conn: Connection, recipientWaId: string, text: string): Promise<SendResult> {
  if (!conn.externalId) {
    return { ok: false, error: "Numero WhatsApp incomplet : le Phone Number ID manque sur la connexion." };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${conn.externalId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientWaId,
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: apiError(data, "Erreur inconnue de l'API WhatsApp.") };
  return { ok: true, externalId: (data as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null };
}

export async function sendChannelMessage(
  conn: Connection,
  recipientId: string,
  text: string,
): Promise<SendResult> {
  if (conn.platform === "whatsapp") return sendViaWhatsapp(conn, recipientId, text);
  if (conn.platform === "facebook") return sendViaFacebookPage(conn, recipientId, text);
  if (conn.platform === "instagram") return sendViaInstagram(conn, recipientId, text);
  return { ok: false, error: `Canal non pris en charge pour l'envoi : ${conn.platform}` };
}
