import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Envoie une réponse à un client qui a écrit sur Messenger (Page Facebook).
// Appelée depuis l'onglet Marketing > Commandes reçues, bouton "Répondre"
// sur une entrée channel = 'facebook'. Le "recipient_id" est le PSID stocké
// dans marketing_orders.customer_phone par meta-webhook.
//
// Instagram Direct utilise la même API Send (même endpoint /me/messages)
// mais nécessite un compte Instagram professionnel lié — pas encore
// configuré (voir statut du projet), donc non couvert ici pour l'instant.

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mimsi-distribution-ennx.vercel.app",
  "https://mimsi-distribution.vercel.app",
  "http://localhost:5173",
];

const configuredOrigins = (Deno.env.get("APP_ORIGINS") ?? Deno.env.get("APP_ORIGIN") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

function corsHeaders(req: Request) {
  const requestOrigin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": requestOrigin && allowedOrigins.has(requestOrigin)
      ? requestOrigin
      : DEFAULT_ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("Origin");
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return jsonResponse(req, { error: "Origine non autorisée" }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  }

  try {
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse(req, { error: "Session expirée, veuillez vous reconnecter." }, 401);
    }

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("access_level")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !callerProfile || callerProfile.access_level < 4) {
      return jsonResponse(req, { error: "Accès refusé — réservé à l'équipe marketing/direction." }, 403);
    }

    const { recipient_id, message, order_id } = await req.json();
    if (!recipient_id || typeof recipient_id !== "string") {
      return jsonResponse(req, { error: "recipient_id est obligatoire." }, 400);
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse(req, { error: "message est obligatoire." }, 400);
    }

    const pageToken = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
    if (!pageToken) {
      return jsonResponse(req, { error: "FACEBOOK_PAGE_ACCESS_TOKEN non configuré côté Supabase." }, 500);
    }

    const graphRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: recipient_id },
        message: { text: message.trim() },
      }),
    });
    const graphData = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok) {
      const errorMessage = (graphData as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API Facebook.";
      return jsonResponse(req, { error: `Facebook a refusé l'envoi : ${errorMessage}` }, 502);
    }

    if (order_id && typeof order_id === "string") {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await serviceClient.from("marketing_orders").update({ status: "en_cours" }).eq("id", order_id);
    }

    return jsonResponse(req, { success: true, message_id: (graphData as { message_id?: string })?.message_id ?? null }, 200);
  } catch (err) {
    console.error("send-facebook-message unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de l'envoi." }, 500);
  }
});
