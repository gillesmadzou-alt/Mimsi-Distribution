import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerOrgId, getConnection, NO_ORG_ERROR, notConnectedError } from "../_shared/tenant.ts";

// Modération des commentaires reçus sur la Page Facebook (table
// facebook_comments, alimentée par meta-webhook). Appelée depuis l'onglet
// Marketing > Commentaires Facebook de l'app. Même pattern d'auth que
// publish-to-facebook (rôle >= 4).
//
// Actions :
//   reply  -> publie une réponse sous le commentaire
//   hide   -> masque le commentaire (reste visible pour son auteur)
//   delete -> supprime définitivement le commentaire
//   block  -> bloque l'auteur du commentaire (il ne peut plus interagir
//             avec la Page, commentaires et messages compris)

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

type Action = "reply" | "hide" | "delete" | "block";
const VALID_ACTIONS: Action[] = ["reply", "hide", "delete", "block"];

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

    const orgId = await callerOrgId(callerClient, user.id);
    if (!orgId) {
      return jsonResponse(req, { error: NO_ORG_ERROR }, 403);
    }

    const { action, comment_id, message } = await req.json();
    if (!VALID_ACTIONS.includes(action)) {
      return jsonResponse(req, { error: `action doit être l'une de : ${VALID_ACTIONS.join(", ")}` }, 400);
    }
    if (!comment_id || typeof comment_id !== "string") {
      return jsonResponse(req, { error: "comment_id est obligatoire." }, 400);
    }
    if (action === "reply" && (!message || typeof message !== "string" || !message.trim())) {
      return jsonResponse(req, { error: "message est obligatoire pour répondre." }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // `comment_id` est fourni par l'appelant et sert ensuite directement
    // d'identifiant Graph. On vérifie donc d'abord que ce commentaire
    // appartient bien à l'organisation de l'appelant : sans ce contrôle, un
    // client pourrait masquer, supprimer ou répondre aux commentaires de la
    // Page d'un autre en devinant un identifiant — le client service_role
    // contourne la RLS.
    const { data: commentRow } = await serviceClient
      .from("facebook_comments")
      .select("from_id")
      .eq("comment_id", comment_id)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!commentRow) {
      return jsonResponse(req, { error: "Commentaire introuvable pour votre organisation." }, 404);
    }

    const conn = await getConnection(serviceClient, orgId, "facebook");
    if (!conn) {
      return jsonResponse(req, { error: notConnectedError("facebook") }, 400);
    }
    const pageToken = conn.accessToken;

    let graphRes: Response;
    let newStatus: string | null = null;

    if (action === "reply") {
      graphRes = await fetch(`https://graph.facebook.com/v21.0/${comment_id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: (message as string).trim(), access_token: pageToken }),
      });
      newStatus = "traite";
    } else if (action === "hide") {
      graphRes = await fetch(
        `https://graph.facebook.com/v21.0/${comment_id}?is_hidden=true&access_token=${encodeURIComponent(pageToken)}`,
        { method: "POST" },
      );
      newStatus = "masque";
    } else if (action === "delete") {
      graphRes = await fetch(
        `https://graph.facebook.com/v21.0/${comment_id}?access_token=${encodeURIComponent(pageToken)}`,
        { method: "DELETE" },
      );
      newStatus = "supprime";
    } else {
      // block
      const pageId = conn.externalId;
      const fromId = commentRow?.from_id;
      if (!pageId) {
        return jsonResponse(req, { error: notConnectedError("facebook") }, 400);
      }
      if (!fromId) {
        return jsonResponse(req, { error: "Auteur du commentaire introuvable, impossible de bloquer." }, 400);
      }
      graphRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/blocked?user=${encodeURIComponent(fromId)}&access_token=${encodeURIComponent(pageToken)}`,
        { method: "POST" },
      );
    }

    const graphData = await graphRes.json().catch(() => ({}));
    if (!graphRes.ok) {
      const errorMessage = (graphData as { error?: { message?: string } })?.error?.message ?? "Erreur inconnue de l'API Facebook.";
      return jsonResponse(req, { error: `Facebook a refusé l'action : ${errorMessage}` }, 502);
    }

    if (newStatus) {
      await serviceClient
        .from("facebook_comments")
        .update({ status: newStatus })
        .eq("comment_id", comment_id)
        .eq("org_id", orgId);
    }

    return jsonResponse(req, { success: true }, 200);
  } catch (err) {
    console.error("manage-facebook-comment unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la modération." }, 500);
  }
});
