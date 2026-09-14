import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendChannelMessage } from "../_shared/messaging.ts";
import { callerOrgId, getConnection, NO_ORG_ERROR, notConnectedError, serviceClient } from "../_shared/tenant.ts";

// Envoie une réponse à un client qui a écrit sur Messenger (Page Facebook).
// Appelée depuis l'onglet Marketing > Commandes reçues, bouton "Répondre"
// sur une entrée channel = 'facebook'. Le "recipient_id" est le PSID stocké
// dans marketing_orders.customer_phone par meta-webhook.
//
// Instagram Direct utilise la même API Send (même endpoint /me/messages)
// mais nécessite un compte Instagram professionnel lié — pas encore
// configuré (voir statut du projet), donc non couvert ici pour l'instant.
//
// Multi-locataire : le jeton n'est plus lu dans l'environnement mais dans la
// connexion Facebook de l'organisation de l'appelant. La mise à jour de la
// commande est elle aussi filtrée sur cette organisation — sans ce filtre, le
// client service_role contournerait la RLS et un appelant pourrait modifier la
// commande d'un autre client en devinant son identifiant.

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

    const orgId = await callerOrgId(callerClient, user.id);
    if (!orgId) {
      return jsonResponse(req, { error: NO_ORG_ERROR }, 403);
    }

    const { recipient_id, message, order_id } = await req.json();
    if (!recipient_id || typeof recipient_id !== "string") {
      return jsonResponse(req, { error: "recipient_id est obligatoire." }, 400);
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse(req, { error: "message est obligatoire." }, 400);
    }

    const admin = serviceClient();

    const conn = await getConnection(admin, orgId, "facebook");
    if (!conn) {
      return jsonResponse(req, { error: notConnectedError("facebook") }, 400);
    }

    const result = await sendChannelMessage(conn, recipient_id, message.trim());
    if (!result.ok) {
      return jsonResponse(req, { error: `Facebook a refusé l'envoi : ${result.error}` }, 502);
    }

    if (order_id && typeof order_id === "string") {
      await admin
        .from("marketing_orders")
        .update({ status: "en_cours" })
        .eq("id", order_id)
        .eq("org_id", orgId);
    }

    await admin
      .from("social_connections")
      .update({ last_used_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("platform", "facebook");

    return jsonResponse(req, { success: true, message_id: result.externalId }, 200);
  } catch (err) {
    console.error("send-facebook-message unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de l'envoi." }, 500);
  }
});
