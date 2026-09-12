import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Reçoit la notification CinetPay (notify_url) puis RE-VÉRIFIE le statut
// auprès de CinetPay via /v2/payment/check avant de mettre à jour la base
// (CinetPay recommande de ne jamais faire confiance à la seule notification
// entrante — toujours re-vérifier côté serveur avec apikey+site_id).
//
// URL à configurer automatiquement par initiate-card-payment (notify_url) :
//   https://<projet>.supabase.co/functions/v1/cinetpay-webhook

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée" }, 405);
  }

  let transactionId: string | undefined;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      transactionId = body.cpm_trans_id ?? body.transaction_id;
    } else {
      const formData = await req.formData();
      transactionId = (formData.get("cpm_trans_id") ?? formData.get("transaction_id"))?.toString();
    }
  } catch {
    return jsonResponse({ received: true, error: "Corps illisible ignoré" }, 200);
  }

  if (!transactionId) {
    return jsonResponse({ received: true, processed: 0 }, 200);
  }

  const apiKey = Deno.env.get("CINETPAY_API_KEY");
  const siteId = Deno.env.get("CINETPAY_SITE_ID");
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!apiKey || !siteId) {
    console.error("cinetpay-webhook: CINETPAY_API_KEY / CINETPAY_SITE_ID non configurés.");
    return jsonResponse({ received: true }, 200);
  }

  const checkRes = await fetch("https://api-checkout.cinetpay.com/v2/payment/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey, site_id: siteId, transaction_id: transactionId }),
  });
  const checkData = await checkRes.json().catch(() => ({}));
  const cpmStatus = (checkData as { data?: { status?: string } })?.data?.status;

  const status = cpmStatus === "ACCEPTED" ? "completed" : cpmStatus === "REFUSED" ? "failed" : "pending";

  const { error } = await serviceClient
    .from("payment_requests")
    .update({ status })
    .eq("provider", "cinetpay")
    .eq("provider_reference", transactionId);

  if (error) {
    console.error("cinetpay-webhook update error:", error.message);
  }

  return jsonResponse({ received: true }, 200);
});
