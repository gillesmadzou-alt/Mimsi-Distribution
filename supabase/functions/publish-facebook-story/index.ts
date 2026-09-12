import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Publie une Story photo sur la Page Facebook Mimsi Distribution.
// Appelée depuis l'onglet Marketing > Publier > Story. Même pattern d'auth
// que publish-to-facebook (rôle >= 4).
//
// Limitation volontaire : seules les Stories PHOTO sont prises en charge.
// Les Stories vidéo et les Lives nécessitent une infrastructure de
// streaming (upload vidéo résumable ou flux RTMP en direct) qui dépasse
// le cadre d'une simple action "publier depuis l'app" — voir la
// documentation Meta si le besoin devient prioritaire.
//
// Étapes API Graph :
//   1. POST /{page-id}/photos?published=false  -> upload la photo (non publiée), renvoie un photo_id
//   2. POST /{page-id}/photo_stories?photo_id=... -> transforme cette photo en Story

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

// Décode une chaîne base64 (avec ou sans préfixe data:...;base64,) en octets.
function decodeBase64Image(input: string): Uint8Array {
  const raw = input.includes(",") ? input.split(",")[1] : input;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== "string") {
      return jsonResponse(req, { error: "image_base64 est obligatoire." }, 400);
    }
    const contentType = typeof mime_type === "string" && mime_type.startsWith("image/") ? mime_type : "image/jpeg";

    const pageId = Deno.env.get("FACEBOOK_PAGE_ID");
    const pageToken = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
    if (!pageId || !pageToken) {
      return jsonResponse(req, { error: "FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN non configurés côté Supabase." }, 500);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: storyRow, error: insertError } = await serviceClient
      .from("facebook_stories")
      .insert({ created_by: user.id })
      .select()
      .single();
    if (insertError) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la Story." }, 500);
    }

    let imageBytes: Uint8Array;
    try {
      imageBytes = decodeBase64Image(image_base64);
    } catch {
      await serviceClient.from("facebook_stories").update({ status: "failed", error: "Image invalide (base64 illisible)." }).eq("id", storyRow.id);
      return jsonResponse(req, { error: "Image invalide." }, 400);
    }

    // Étape 1 : upload de la photo, non publiée sur le fil de la Page.
    const uploadForm = new FormData();
    uploadForm.append("published", "false");
    uploadForm.append("access_token", pageToken);
    uploadForm.append("source", new Blob([imageBytes], { type: contentType }), "story.jpg");

    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: "POST",
      body: uploadForm,
    });
    const uploadData = await uploadRes.json().catch(() => ({}));

    if (!uploadRes.ok) {
      const errorMessage = (uploadData as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue lors de l'envoi de la photo.";
      await serviceClient.from("facebook_stories").update({ status: "failed", error: errorMessage }).eq("id", storyRow.id);
      return jsonResponse(req, { error: `Facebook a refusé l'envoi de la photo : ${errorMessage}` }, 502);
    }

    const photoId = (uploadData as { id?: string })?.id;
    if (!photoId) {
      await serviceClient.from("facebook_stories").update({ status: "failed", error: "Aucun photo_id renvoyé par Facebook." }).eq("id", storyRow.id);
      return jsonResponse(req, { error: "Réponse Facebook inattendue (pas de photo_id)." }, 502);
    }

    // Étape 2 : transforme cette photo en Story.
    const storyRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/photo_stories?photo_id=${encodeURIComponent(photoId)}&access_token=${encodeURIComponent(pageToken)}`,
      { method: "POST" },
    );
    const storyData = await storyRes.json().catch(() => ({}));

    if (!storyRes.ok) {
      const errorMessage = (storyData as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue lors de la publication de la Story.";
      await serviceClient.from("facebook_stories").update({ status: "failed", fb_photo_id: photoId, error: errorMessage }).eq("id", storyRow.id);
      return jsonResponse(req, { error: `Facebook a refusé la Story : ${errorMessage}` }, 502);
    }

    await serviceClient.from("facebook_stories").update({
      status: "published",
      fb_photo_id: photoId,
      fb_story_id: (storyData as { post_id?: string; id?: string })?.post_id ?? (storyData as { id?: string })?.id ?? null,
      published_at: new Date().toISOString(),
    }).eq("id", storyRow.id);

    return jsonResponse(req, { success: true, photo_id: photoId }, 200);
  } catch (err) {
    console.error("publish-facebook-story unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la publication de la Story." }, 500);
  }
});
