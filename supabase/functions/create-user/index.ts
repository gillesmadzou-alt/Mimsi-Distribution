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

function emailFromFullName(fullName: string): string {
  const normalized = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return `${normalized}@mimsidistribution.com`;
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse(req, { error: "Session expirée, veuillez vous reconnecter." }, 401);
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !callerProfile || callerProfile.role !== 6) {
      return jsonResponse(req, { error: "Accès refusé — administrateur uniquement" }, 403);
    }

    const { password, fullName, role } = await req.json();
    if (!password || !fullName || role === undefined) {
      return jsonResponse(req, { error: "Nom, mot de passe et rôle sont obligatoires." }, 400);
    }

    const allowedRoles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];
    if (!allowedRoles.includes(role)) {
      return jsonResponse(req, { error: "Rôle non autorisé" }, 400);
    }
    const email = emailFromFullName(fullName);
    if (email === '@mimsidistribution.com') {
      return jsonResponse(req, { error: "Le nom complet est invalide." }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      console.error("createUser error:", createError.message);
      const duplicate = createError.message.toLowerCase().includes("already")
        || createError.message.toLowerCase().includes("exists");
      return jsonResponse(req, {
        error: duplicate
          ? `Un compte existe déjà avec l’identifiant ${email}.`
          : "Impossible de créer le compte utilisateur.",
      }, 400);
    }

    const { error: profileInsertError } = await serviceClient.from("profiles").insert({
      id: newUser.user.id,
      full_name: fullName,
      role,
      is_active: true,
    });

    if (profileInsertError) {
      await serviceClient.auth.admin.deleteUser(newUser.user.id);
      console.error("profile insert error:", profileInsertError.message);
      return jsonResponse(req, { error: "Impossible de créer le profil. Réessayez." }, 400);
    }

    return jsonResponse(req, { success: true, userId: newUser.user.id, email }, 200);
  } catch (err) {
    console.error("create-user unexpected error:", err);
    return jsonResponse(req, { error: "Erreur serveur lors de la création du compte." }, 500);
  }
});
