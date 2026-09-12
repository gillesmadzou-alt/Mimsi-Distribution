import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

// Publie un post sur la Page Facebook Mimsi Distribution via l'API Graph
// (Pages API). Appelée directement depuis l'app (onglet Marketing >
// Publier) — contrairement à receive-marketing-order, ce n'est pas un
// webhook entrant, c'est une action déclenchée par un membre de l'équipe
// (rôle >= 4, comme le reste de la page Marketing).
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
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
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

    const { message, link } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse(req, { error: "Le message est obligatoire." }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: postRow, error: insertError } = await serviceClient
      .from("facebook_posts")
      .insert({ message: message.trim(), link: link?.trim() || null, created_by: user.id })
      .select()
      .single();
    if (insertError) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la publication." }, 500);
    }

    const pageId = Deno.env.get("FACEBOOK_PAGE_ID");
    const pageToken = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
    if (!pageId || !pageToken) {
      await serviceClient.from("facebook_posts").update({
        status: "failed",
        error: "FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN non configurés côté Supabase.",
      }).eq("id", postRow.id);
      return jsonResponse(req, { error: "Configuration Facebook incomplète (secrets manquants)." }, 500);
    }

    const graphBody: Record<string, string> = { message: message.trim(), access_token: pageToken };
    if (link?.trim()) graphBody.link = link.trim();

    const graphRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graphBody),
    });
    const graphData = await graphRes.json();

    if (!graphRes.ok) {
      const errorMessage = graphData?.error?.message ?? "Erreur inconnue de l'API Facebook.";
      await serviceClient.from("facebook_posts").update({ status: "failed", error: errorMessage }).eq("id", postRow.id);
      return jsonResponse(req, { error: `Facebook a refusé la publication : ${errorMessage}` }, 502);
    }

    await serviceClient.from("facebook_posts").update({
      status: "published",
      fb_post_id: graphData.id ?? null,
      published_at: new Date().toISOString(),
    }).eq("id", postRow.id);

    return jsonResponse(req, { success: true, fb_post_id: graphData.id ?? null }, 200);
  } catch (err) {
    console.error("publish-to-facebook unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la publication." }, 500);
  }
});
