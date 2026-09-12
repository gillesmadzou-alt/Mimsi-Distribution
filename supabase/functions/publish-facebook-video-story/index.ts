import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Publie une Story VIDÉO sur la Page Facebook Mimsi Distribution. Même
// principe que publish-facebook-story (photo), mais utilise le protocole
// d'upload "resumable" de l'API Graph, requis pour toute vidéo :
//
//   1. upload_phase=start   -> ouvre une session d'upload, renvoie video_id
//   2. upload_phase=transfer -> envoie les octets de la vidéo (en un seul
//                                bloc ici : adapté à de courts clips, pas à
//                                de longues vidéos — voir la limite plus bas)
//   3. upload_phase=finish  -> clôture l'upload (vidéo non publiée sur le fil)
//   4. POST /{page}/video_stories?video_id=... -> transforme en Story
//
// Limite volontaire : la vidéo est envoyée en un seul appel "transfer"
// (pas de découpage en morceaux). Convient à de courts clips façon Story
// (quelques secondes à ~1 minute, quelques Mo) — pas à de longues vidéos.
// Réservé au rôle >= 4 (même pattern que publish-to-facebook).

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

function decodeBase64(input: string): Uint8Array {
  const raw = input.includes(",") ? input.split(",")[1] : input;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Vidéo max ~18 Mo en base64 (≈ 24 Mo décodés) : reste raisonnable pour un
// appel HTTP unique (limite de taille de requête des fonctions Edge) et
// couvre largement un clip de quelques secondes façon Story.
const MAX_BASE64_LENGTH = 24_000_000;

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

    const { video_base64, mime_type } = await req.json();
    if (!video_base64 || typeof video_base64 !== "string") {
      return jsonResponse(req, { error: "video_base64 est obligatoire." }, 400);
    }
    if (video_base64.length > MAX_BASE64_LENGTH) {
      return jsonResponse(req, { error: "Vidéo trop volumineuse — reste sur un clip court (quelques secondes, type Story)." }, 400);
    }

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
      .insert({ created_by: user.id, media_type: "video" })
      .select()
      .single();
    if (insertError) {
      return jsonResponse(req, { error: "Impossible d'enregistrer la Story." }, 500);
    }

    const fail = async (error: string) => {
      await serviceClient.from("facebook_stories").update({ status: "failed", error }).eq("id", storyRow.id);
      return jsonResponse(req, { error }, 502);
    };

    let videoBytes: Uint8Array;
    try {
      videoBytes = decodeBase64(video_base64);
    } catch {
      return fail("Vidéo invalide (base64 illisible).");
    }

    // --- Étape 1 : start ---
    const startForm = new FormData();
    startForm.append("upload_phase", "start");
    startForm.append("file_size", String(videoBytes.length));
    startForm.append("access_token", pageToken);

    const startRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, { method: "POST", body: startForm });
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      return fail((startData as { error?: { message?: string } })?.error?.message ?? "Erreur lors de l'ouverture de la session d'upload vidéo.");
    }
    const uploadSessionId = (startData as { upload_session_id?: string })?.upload_session_id;
    const videoId = (startData as { video_id?: string })?.video_id;
    if (!uploadSessionId || !videoId) {
      return fail("Réponse Facebook inattendue à l'ouverture de la session d'upload.");
    }

    // --- Étape 2 : transfer (en un seul bloc) ---
    const transferForm = new FormData();
    transferForm.append("upload_phase", "transfer");
    transferForm.append("upload_session_id", uploadSessionId);
    transferForm.append("start_offset", "0");
    transferForm.append("access_token", pageToken);
    transferForm.append("video_file_chunk", new Blob([videoBytes], { type: mime_type || "video/mp4" }), "story.mp4");

    const transferRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, { method: "POST", body: transferForm });
    const transferData = await transferRes.json().catch(() => ({}));
    if (!transferRes.ok) {
      return fail((transferData as { error?: { message?: string } })?.error?.message ?? "Erreur lors de l'envoi de la vidéo.");
    }

    // --- Étape 3 : finish ---
    const finishForm = new FormData();
    finishForm.append("upload_phase", "finish");
    finishForm.append("upload_session_id", uploadSessionId);
    finishForm.append("access_token", pageToken);

    const finishRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, { method: "POST", body: finishForm });
    const finishData = await finishRes.json().catch(() => ({}));
    if (!finishRes.ok || !(finishData as { success?: boolean })?.success) {
      return fail((finishData as { error?: { message?: string } })?.error?.message ?? "Erreur lors de la finalisation de l'upload vidéo.");
    }

    // --- Étape 4 : transforme la vidéo en Story ---
    const storyRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/video_stories?video_id=${encodeURIComponent(videoId)}&access_token=${encodeURIComponent(pageToken)}`,
      { method: "POST" },
    );
    const storyData = await storyRes.json().catch(() => ({}));
    if (!storyRes.ok) {
      await serviceClient.from("facebook_stories").update({ status: "failed", fb_video_id: videoId, error: (storyData as { error?: { message?: string } })?.error?.message ?? "Erreur lors de la publication de la Story vidéo." }).eq("id", storyRow.id);
      return jsonResponse(req, { error: (storyData as { error?: { message?: string } })?.error?.message ?? "Facebook a refusé la Story vidéo." }, 502);
    }

    await serviceClient.from("facebook_stories").update({
      status: "published",
      fb_video_id: videoId,
      fb_story_id: (storyData as { post_id?: string; id?: string })?.post_id ?? (storyData as { id?: string })?.id ?? null,
      published_at: new Date().toISOString(),
    }).eq("id", storyRow.id);

    return jsonResponse(req, { success: true, video_id: videoId }, 200);
  } catch (err) {
    console.error("publish-facebook-video-story unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la publication de la Story vidéo." }, 500);
  }
});
