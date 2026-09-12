import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendChannelMessage, OutboundChannel } from "../_shared/messaging.ts";

// Diffusion groupée : envoie un même message à tous les clients connus
// (distincts, par channel + customer_phone dans marketing_orders) d'un
// canal donné, ou de tous les canaux. Appelée depuis l'onglet Marketing >
// Diffusion. Réservé au rôle >= 4 (équipe marketing/direction), comme le
// reste de la page Marketing.
//
// Limite volontaire : WhatsApp/Messenger n'autorisent l'envoi libre que dans
// une fenêtre de 24h après le dernier message du client (sinon il faut un
// message "template" pré-approuvé) — cette fonction n'impose pas cette
// règle elle-même, Meta refusera simplement les envois hors fenêtre (le
// destinataire concerné sera compté en échec, avec l'erreur de Meta dans les
// logs).

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

const VALID_CHANNELS = ["all", "whatsapp", "facebook", "instagram"] as const;

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

    const { message, channel } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse(req, { error: "Le message est obligatoire." }, 400);
    }
    const channelFilter = (VALID_CHANNELS as readonly string[]).includes(channel) ? channel : "all";

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Destinataires = clients distincts connus dans marketing_orders (ceux
    // qui nous ont déjà contactés), filtrés par canal si demandé.
    let query = serviceClient
      .from("marketing_orders")
      .select("channel, customer_phone")
      .not("customer_phone", "is", null);
    if (channelFilter !== "all") query = query.eq("channel", channelFilter);
    else query = query.in("channel", ["whatsapp", "facebook", "instagram"]);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) {
      return jsonResponse(req, { error: "Impossible de récupérer la liste des destinataires." }, 500);
    }

    const seen = new Set<string>();
    const recipients: { channel: OutboundChannel; recipientId: string }[] = [];
    for (const row of rows ?? []) {
      const key = `${row.channel}:${row.customer_phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ channel: row.channel as OutboundChannel, recipientId: row.customer_phone as string });
    }

    const { data: broadcastRow, error: insertError } = await serviceClient
      .from("broadcasts")
      .insert({
        message: message.trim(),
        channel: channelFilter,
        recipients_total: recipients.length,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insertError || !broadcastRow) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la diffusion." }, 500);
    }

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const result = await sendChannelMessage(r.channel, r.recipientId, message.trim());
      if (result.ok) sent++;
      else {
        failed++;
        console.error(`broadcast-message: échec envoi ${r.channel} -> ${r.recipientId}:`, result.error);
      }
    }

    await serviceClient
      .from("broadcasts")
      .update({
        status: failed > 0 && sent === 0 ? "echec" : "termine",
        recipients_sent: sent,
        recipients_failed: failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", broadcastRow.id);

    return jsonResponse(req, { success: true, total: recipients.length, sent, failed }, 200);
  } catch (err) {
    console.error("broadcast-message unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la diffusion." }, 500);
  }
});
