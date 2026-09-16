import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mimsi-distribution.vercel.app",
  "https://mimsi-distribution-ennx.vercel.app",
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

    if (profileErr || !callerProfile || callerProfile.access_level !== 6) {
      return jsonResponse(req, { error: "Accès refusé — administrateur uniquement" }, 403);
    }

    const { targetUserId, role, accessLevel, newPassword } = await req.json();
    if (!targetUserId) {
      return jsonResponse(req, { error: "Utilisateur cible manquant." }, 400);
    }
    if (role === undefined && accessLevel === undefined && !newPassword) {
      return jsonResponse(req, { error: "Aucune modification à appliquer." }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (newPassword) {
      if (typeof newPassword !== "string" || newPassword.length < 6) {
        return jsonResponse(req, { error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      }
      const { error: pwError } = await serviceClient.auth.admin.updateUserById(targetUserId, { password: newPassword });
      if (pwError) {
        console.error("updateUserById password error:", pwError.message);
        return jsonResponse(req, { error: "Impossible de modifier le mot de passe." }, 400);
      }
    }

    if (role !== undefined || accessLevel !== undefined) {
      const allowedRoles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
      if (role !== undefined && !allowedRoles.includes(role)) {
        return jsonResponse(req, { error: "Rôle non autorisé" }, 400);
      }
      if (accessLevel !== undefined && (!Number.isInteger(accessLevel) || accessLevel < 1 || accessLevel > 6)) {
        return jsonResponse(req, { error: "Le niveau d’accès doit être compris entre 1 et 6." }, 400);
      }
      const updates: Record<string, unknown> = {};
      if (role !== undefined) updates.role = role;
      if (accessLevel !== undefined) updates.access_level = accessLevel;

      const { error: profileUpdateError } = await serviceClient
        .from("profiles")
        .update(updates)
        .eq("id", targetUserId);
      if (profileUpdateError) {
        console.error("profile update error:", profileUpdateError.message);
        return jsonResponse(req, { error: "Impossible de modifier le profil." }, 400);
      }
    }

    return jsonResponse(req, { success: true }, 200);
  } catch (err) {
    console.error("update-user unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la modification du compte." }, 500);
  }
});
