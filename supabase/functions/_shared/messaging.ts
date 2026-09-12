// Module partagé : envoi de messages sortants, quel que soit le canal.
// Utilisé par send-facebook-message, meta-webhook (bot auto-réponse),
// broadcast-message et send-payment-reminders — pour ne pas dupliquer la
// logique d'appel aux API Graph (Facebook/Instagram) et WhatsApp Cloud API.

export type OutboundChannel = "facebook" | "instagram" | "whatsapp";

export type SendResult = { ok: true; externalId: string | null } | { ok: false; error: string };

// Facebook Messenger & Instagram Direct partagent la même API Send, avec le
// token de Page (FACEBOOK_PAGE_ACCESS_TOKEN).
async function sendViaPageAPI(recipientId: string, text: string): Promise<SendResult> {
  const pageToken = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
  if (!pageToken) return { ok: false, error: "FACEBOOK_PAGE_ACCESS_TOKEN non configuré côté Supabase." };

  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: { text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API Facebook." };
  }
  return { ok: true, externalId: (data as { message_id?: string })?.message_id ?? null };
}

// WhatsApp Cloud API : nécessite un numéro de téléphone enregistré (pas le
// numéro de test) et son Phone Number ID + un token d'accès dédié. Tant que
// ces secrets ne sont pas configurés, cette fonction renvoie une erreur
// explicite plutôt que d'échouer silencieusement.
async function sendViaWhatsapp(recipientWaId: string, text: string): Promise<SendResult> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return { ok: false, error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID non configurés côté Supabase (numéro WhatsApp de production pas encore enregistré)." };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientWaId,
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API WhatsApp." };
  }
  const messageId = (data as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null;
  return { ok: true, externalId: messageId };
}

export async function sendChannelMessage(
  channel: OutboundChannel,
  recipientId: string,
  text: string,
): Promise<SendResult> {
  if (channel === "whatsapp") return sendViaWhatsapp(recipientId, text);
  if (channel === "facebook" || channel === "instagram") return sendViaPageAPI(recipientId, text);
  return { ok: false, error: `Canal non pris en charge pour l'envoi : ${channel}` };
}
