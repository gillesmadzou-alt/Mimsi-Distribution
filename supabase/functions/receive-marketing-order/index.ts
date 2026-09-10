import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Point d'entrée appelé par n8n (pas par le navigateur) quand une commande /
// un message de commande arrive depuis Facebook, WhatsApp, Instagram ou
// TikTok. n8n reçoit le webhook natif de chaque plateforme, en extrait les
// champs utiles, puis POST ici au format normalisé ci-dessous.
//
// Sécurité : pas de session utilisateur ici (n8n n'est pas un humain connecté
// à l'app), donc l'accès est protégé par un secret partagé transmis dans
// l'en-tête `x-webhook-secret`, à définir côté Supabase avec :
//   supabase secrets set MARKETING_WEBHOOK_SECRET=<valeur-longue-aleatoire>
// et à reporter dans les credentials du node HTTP Request de n8n.

type Channel = "facebook" | "whatsapp" | "instagram" | "tiktok" | "autre";
const VALID_CHANNELS: Channel[] = ["facebook", "whatsapp", "instagram", "tiktok", "autre"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-webhook-secret",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée" }, 405);
  }

  const expectedSecret = Deno.env.get("MARKETING_WEBHOOK_SECRET");
  if (!expectedSecret) {
    console.error("MARKETING_WEBHOOK_SECRET n'est pas configuré côté serveur.");
    return jsonResponse({ error: "Automatisation non configurée côté serveur." }, 500);
  }
  const providedSecret = req.headers.get("x-webhook-secret");
  if (providedSecret !== expectedSecret) {
    return jsonResponse({ error: "Secret invalide" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête JSON invalide" }, 400);
  }

  const channel = String(body.channel ?? "").toLowerCase();
  if (!VALID_CHANNELS.includes(channel as Channel)) {
    return jsonResponse({ error: `channel doit être l'un de : ${VALID_CHANNELS.join(", ")}` }, 400);
  }

  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim().slice(0, 200) : null;
  const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim().slice(0, 50) : null;
  const message = typeof body.message === "string" ? body.message.slice(0, 5000) : null;
  const externalId = typeof body.external_id === "string" ? body.external_id.slice(0, 200) : null;
  const orderDetails = (body.order_details && typeof body.order_details === "object") ? body.order_details : null;

  if (!customerName && !customerPhone && !message) {
    return jsonResponse({ error: "Fournissez au moins customer_name, customer_phone ou message." }, 400);
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await serviceClient
    .from("marketing_orders")
    .upsert(
      {
        channel,
        customer_name: customerName,
        customer_phone: customerPhone,
        message,
        order_details: orderDetails,
        external_id: externalId,
        raw_payload: body,
        status: "nouveau",
      },
      externalId ? { onConflict: "channel,external_id", ignoreDuplicates: true } : undefined,
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("receive-marketing-order insert error:", error.message);
    return jsonResponse({ error: "Impossible d'enregistrer la commande." }, 500);
  }

  return jsonResponse({ success: true, id: data?.id ?? null, deduplicated: !data }, 200);
});
