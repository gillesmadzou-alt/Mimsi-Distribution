import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Reçoit les notifications de statut de PawaPay pour un dépôt (paiement
// Mobile Money) et met à jour la ligne payment_requests correspondante.
// URL à configurer dans le tableau de bord PawaPay (callback URL) :
//   https://<projet>.supabase.co/functions/v1/pawapay-webhook
//
// Pas d'authentification Supabase ici (appelé par PawaPay, pas par un
// utilisateur de l'app) — la légitimité de l'appel repose sur le caractère
// secret de cette URL. À renforcer plus tard si PawaPay fournit une
// signature de webhook vérifiable.

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ received: true, error: "Corps JSON invalide ignoré" }, 200);
  }

  const depositId = body.depositId as string | undefined;
  const pawaStatus = body.status as string | undefined;
  if (!depositId) {
    return jsonResponse({ received: true, processed: 0 }, 200);
  }

  const statusMap: Record<string, string> = {
    COMPLETED: "completed",
    ACCEPTED: "accepted",
    SUBMITTED: "accepted",
    FAILED: "failed",
    REJECTED: "failed",
  };
  const mappedStatus = statusMap[pawaStatus ?? ""] ?? "pending";

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const errorMessage = (body.failureReason as { failureMessage?: string } | undefined)?.failureMessage ?? null;

  const { error } = await serviceClient
    .from("payment_requests")
    .update({ status: mappedStatus, error: errorMessage })
    .eq("provider", "pawapay")
    .eq("provider_reference", depositId);

  if (error) {
    console.error("pawapay-webhook update error:", error.message);
  }

  return jsonResponse({ received: true }, 200);
});
