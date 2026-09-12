import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendChannelMessage } from "../_shared/messaging.ts";

// Relance les points de vente ayant une créance en attente ou partielle
// (table `receivables`) via WhatsApp, sur leur `owner_phone` (sales_points).
// Appelée manuellement depuis l'app (bouton "Envoyer les relances") —
// aucun envoi automatique/programmé pour l'instant.
//
// Nécessite WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID (numéro
// WhatsApp de production), pas encore configurés tant que le numéro
// définitif n'est pas enregistré côté Meta.

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

function formatFcfa(amount: number) {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
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

    // Seuil plus élevé : relancer des partenaires sur des sommes dues est
    // sensible, réservé à la direction (comme la comptabilité).
    if (profileErr || !callerProfile || callerProfile.access_level < 5) {
      return jsonResponse(req, { error: "Accès refusé — réservé à la direction." }, 403);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: receivables, error: recvError } = await serviceClient
      .from("receivables")
      .select("id, amount_fcfa, amount_paid, status, sales_point_id, sales_points(name, owner_phone, owner_name)")
      .in("status", ["en_attente", "partiel"]);

    if (recvError) {
      return jsonResponse(req, { error: "Impossible de récupérer les créances en attente." }, 500);
    }

    // Regroupe par point de vente (un point de vente peut avoir plusieurs
    // créances en attente : on envoie un seul message avec le total dû).
    const bySalesPoint = new Map<string, { name: string; ownerName: string | null; phone: string; due: number; count: number }>();
    for (const r of receivables ?? []) {
      const sp = (r as { sales_points?: { name?: string; owner_phone?: string; owner_name?: string } }).sales_points;
      if (!sp?.owner_phone) continue; // pas de numéro connu, impossible de relancer
      const due = (r.amount_fcfa as number) - (r.amount_paid as number);
      if (due <= 0) continue;
      const key = r.sales_point_id as string;
      const existing = bySalesPoint.get(key);
      if (existing) {
        existing.due += due;
        existing.count += 1;
      } else {
        bySalesPoint.set(key, { name: sp.name ?? "Point de vente", ownerName: sp.owner_name ?? null, phone: sp.owner_phone, due, count: 1 });
      }
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const [, info] of bySalesPoint) {
      const greeting = info.ownerName ? `Bonjour ${info.ownerName}` : "Bonjour";
      const message = `${greeting},\n\nCeci est un rappel amical : votre point de vente "${info.name}" a un solde de ${formatFcfa(info.due)} en attente auprès de Mimsi Distribution (${info.count} créance${info.count > 1 ? "s" : ""}).\n\nMerci de régulariser dès que possible. N'hésitez pas à nous contacter pour toute question.`;
      const result = await sendChannelMessage("whatsapp", info.phone, message);
      if (result.ok) sent++;
      else {
        failed++;
        errors.push(`${info.name}: ${result.error}`);
      }
    }

    return jsonResponse(req, {
      success: true,
      sales_points_relances: bySalesPoint.size,
      sent,
      failed,
      errors: errors.slice(0, 5), // aperçu, pas la liste complète si beaucoup d'échecs
    }, 200);
  } catch (err) {
    console.error("send-payment-reminders unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de l'envoi des relances." }, 500);
  }
});
