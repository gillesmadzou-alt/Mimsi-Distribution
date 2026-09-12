import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Initie un paiement Mobile Money (Airtel Money / MTN Mobile Money, Congo)
// via l'API PawaPay v2 (dépôt). Le client reçoit une invite de paiement
// (USSD/notification push) directement sur son téléphone — pas de
// redirection web nécessaire.
//
// Nécessite le secret Supabase :
//   PAWAPAY_API_TOKEN  (token Bearer généré dans le tableau de bord PawaPay)
// Optionnel :
//   PAWAPAY_ENV = "production" (par défaut : sandbox, pour les tests)
//
// Réservé au rôle >= 4. Le statut final arrive via le webhook
// pawapay-webhook (asynchrone) — cette fonction ne fait qu'initier.

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

    const { amount_fcfa, customer_phone, customer_name, mobile_money_provider, receivable_id, marketing_order_id } = await req.json();

    if (!amount_fcfa || typeof amount_fcfa !== "number" || amount_fcfa <= 0) {
      return jsonResponse(req, { error: "amount_fcfa est obligatoire et doit être positif." }, 400);
    }
    if (!customer_phone || typeof customer_phone !== "string") {
      return jsonResponse(req, { error: "customer_phone est obligatoire (format international, ex: 242069925464)." }, 400);
    }
    if (!mobile_money_provider || typeof mobile_money_provider !== "string") {
      return jsonResponse(req, {
        error: "mobile_money_provider est obligatoire (code exact fourni par PawaPay pour le Congo, ex: MTN_MOMO_COG ou AIRTEL_COG — à vérifier dans le tableau de bord PawaPay).",
      }, 400);
    }

    const apiToken = Deno.env.get("PAWAPAY_API_TOKEN");
    if (!apiToken) {
      return jsonResponse(req, { error: "PAWAPAY_API_TOKEN non configuré côté Supabase." }, 500);
    }
    const baseUrl = Deno.env.get("PAWAPAY_ENV") === "production"
      ? "https://api.pawapay.io"
      : "https://api.sandbox.pawapay.io";

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const depositId = crypto.randomUUID();

    const { data: row, error: insertError } = await serviceClient
      .from("payment_requests")
      .insert({
        provider: "pawapay",
        method: "mobile_money",
        amount_fcfa,
        customer_name: customer_name ?? null,
        customer_phone,
        mobile_money_provider,
        provider_reference: depositId,
        receivable_id: receivable_id ?? null,
        marketing_order_id: marketing_order_id ?? null,
        created_by: user.id,
      })
      .select()
      .single();
    if (insertError) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la demande de paiement." }, 500);
    }

    const pawaRes = await fetch(`${baseUrl}/v2/deposits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({
        depositId,
        amount: String(amount_fcfa),
        currency: "XAF",
        payer: {
          type: "MMO",
          accountDetails: { phoneNumber: customer_phone, provider: mobile_money_provider },
        },
        customerMessage: "Paiement Mimsi",
      }),
    });
    const pawaData = await pawaRes.json().catch(() => ({}));

    if (!pawaRes.ok) {
      const errorMessage = (pawaData as { failureReason?: { failureMessage?: string }; message?: string })?.failureReason?.failureMessage
        ?? (pawaData as { message?: string })?.message
        ?? "Erreur inconnue de PawaPay.";
      await serviceClient.from("payment_requests").update({ status: "failed", error: errorMessage }).eq("id", row.id);
      return jsonResponse(req, { error: `PawaPay a refusé la demande : ${errorMessage}` }, 502);
    }

    const status = (pawaData as { status?: string })?.status === "ACCEPTED" ? "accepted" : "pending";
    await serviceClient.from("payment_requests").update({ status }).eq("id", row.id);

    return jsonResponse(req, { success: true, deposit_id: depositId, status }, 200);
  } catch (err) {
    console.error("initiate-mobile-money-payment unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de l'initiation du paiement." }, 500);
  }
});
