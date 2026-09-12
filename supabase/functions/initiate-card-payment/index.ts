import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Initie un paiement par carte (Visa/Mastercard) via l'API CinetPay
// (Checkout hébergé — le client est redirigé vers une page de paiement
// sécurisée CinetPay, puis revient sur l'app).
//
// Nécessite les secrets Supabase :
//   CINETPAY_API_KEY, CINETPAY_SITE_ID
// Optionnel :
//   APP_ORIGIN (déjà utilisé ailleurs) pour construire un return_url par défaut.
//
// Réservé au rôle >= 4. Le statut final arrive via le webhook
// cinetpay-webhook — cette fonction renvoie juste l'URL de paiement à
// ouvrir côté client.

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

    const { amount_fcfa, customer_name, customer_phone, receivable_id, marketing_order_id } = await req.json();
    if (!amount_fcfa || typeof amount_fcfa !== "number" || amount_fcfa <= 0) {
      return jsonResponse(req, { error: "amount_fcfa est obligatoire et doit être positif." }, 400);
    }

    const apiKey = Deno.env.get("CINETPAY_API_KEY");
    const siteId = Deno.env.get("CINETPAY_SITE_ID");
    if (!apiKey || !siteId) {
      return jsonResponse(req, { error: "CINETPAY_API_KEY / CINETPAY_SITE_ID non configurés côté Supabase." }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const transactionId = crypto.randomUUID();

    const { data: row, error: insertError } = await serviceClient
      .from("payment_requests")
      .insert({
        provider: "cinetpay",
        method: "card",
        amount_fcfa,
        customer_name: customer_name ?? null,
        customer_phone: customer_phone ?? null,
        provider_reference: transactionId,
        receivable_id: receivable_id ?? null,
        marketing_order_id: marketing_order_id ?? null,
        created_by: user.id,
      })
      .select()
      .single();
    if (insertError) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la demande de paiement." }, 500);
    }

    const notifyUrl = `${supabaseUrl}/functions/v1/cinetpay-webhook`;
    const returnUrl = configuredOrigins[0] ?? DEFAULT_ALLOWED_ORIGINS[0];

    const cinetRes = await fetch("https://api-checkout.cinetpay.com/v2/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: apiKey,
        site_id: siteId,
        transaction_id: transactionId,
        amount: amount_fcfa,
        currency: "XAF",
        description: "Paiement Mimsi Distribution",
        customer_name: customer_name ?? "Client",
        customer_surname: "Mimsi",
        customer_phone_number: customer_phone ?? "",
        notify_url: notifyUrl,
        return_url: returnUrl,
        channels: "CREDIT_CARD",
      }),
    });
    const cinetData = await cinetRes.json().catch(() => ({}));

    const cinetCode = (cinetData as { code?: string })?.code;
    if (!cinetRes.ok || cinetCode !== "201") {
      const errorMessage = (cinetData as { message?: string; description?: string })?.description
        ?? (cinetData as { message?: string })?.message
        ?? "Erreur inconnue de CinetPay.";
      await serviceClient.from("payment_requests").update({ status: "failed", error: errorMessage }).eq("id", row.id);
      return jsonResponse(req, { error: `CinetPay a refusé la demande : ${errorMessage}` }, 502);
    }

    const paymentUrl = (cinetData as { data?: { payment_url?: string } })?.data?.payment_url ?? null;
    await serviceClient.from("payment_requests").update({ status: "pending", payment_url: paymentUrl }).eq("id", row.id);

    return jsonResponse(req, { success: true, payment_url: paymentUrl, transaction_id: transactionId }, 200);
  } catch (err) {
    console.error("initiate-card-payment unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de l'initiation du paiement." }, 500);
  }
});
