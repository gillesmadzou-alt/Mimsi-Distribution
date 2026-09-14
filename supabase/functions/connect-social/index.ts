import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptToken } from "../_shared/crypto.ts";
import { callerOrgId, NO_ORG_ERROR, serviceClient } from "../_shared/tenant.ts";

// Branchement d'un compte Facebook / Instagram par le commerçant lui-même.
//
// C'est ce parcours qui remplace la configuration manuelle dans Meta for
// Developers : jusqu'ici, brancher un compte voulait dire coller un jeton dans
// les secrets Supabase, donc une seule entreprise par déploiement.
//
// Déroulé :
//   1. Le navigateur envoie l'utilisateur sur la boîte de dialogue Facebook
//      (voir `authUrl` renvoyé par l'action "start"), qui le ramène sur
//      l'application avec un `code`.
//   2. L'application appelle cette fonction avec ce `code` (action "exchange").
//   3. On échange le code contre un jeton utilisateur courte durée, puis
//      longue durée (~60 jours), puis on liste les Pages administrées.
//   4. L'utilisateur choisit sa Page (action "pages" puis "select").
//   5. Le jeton de Page est chiffré et enregistré dans `social_connections`.
//
// Le jeton ne transite jamais vers le navigateur : l'échange se fait
// entièrement ici, et la fonction ne renvoie que des noms et des identifiants.
//
// Secrets requis :
//   supabase secrets set META_APP_ID=<id de l'app Meta>
//   supabase secrets set META_APP_SECRET=<secret de l'app Meta>
//   supabase secrets set TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"

const GRAPH = "https://graph.facebook.com/v21.0";

// Permissions demandées. Toutes sont en « accès avancé » chez Meta et
// supposent une App Review validée (voir docs/saas-strategie-produit.md § 5.2).
const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_engagement",
  "pages_messaging",
  "business_management",
];
const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_messages", "instagram_content_publish"];

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mimsi-distribution-ennx.vercel.app",
  "https://mimsi-distribution.vercel.app",
  "http://localhost:5173",
];

const configuredOrigins = (Deno.env.get("APP_ORIGINS") ?? Deno.env.get("APP_ORIGIN") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : DEFAULT_ALLOWED_ORIGINS[0],
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

type GraphError = { error?: { message?: string } };

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as GraphError)?.error?.message ?? "Erreur inconnue de l'API Meta.");
  }
  return data as T;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) {
    return jsonResponse(req, { error: "Origine non autorisée" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);

  try {
    const appId = Deno.env.get("META_APP_ID");
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (!appId || !appSecret) {
      return jsonResponse(req, { error: "META_APP_ID / META_APP_SECRET non configurés côté Supabase." }, 500);
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse(req, { error: "Session expirée, veuillez vous reconnecter." }, 401);
    }

    // Brancher un compte engage toute l'organisation : réservé à la direction.
    const { data: profile } = await callerClient
      .from("profiles")
      .select("access_level")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.access_level < 5) {
      return jsonResponse(req, { error: "Accès refusé — la connexion d'un compte est réservée à la direction." }, 403);
    }

    const orgId = await callerOrgId(callerClient, user.id);
    if (!orgId) return jsonResponse(req, { error: NO_ORG_ERROR }, 403);

    const { action, platform, code, redirect_uri, page_id, user_token } = await req.json();

    if (platform !== "facebook" && platform !== "instagram") {
      return jsonResponse(req, { error: "Plateforme non prise en charge par ce parcours." }, 400);
    }
    if (!redirect_uri || typeof redirect_uri !== "string" || !allowedOrigins.has(new URL(redirect_uri).origin)) {
      return jsonResponse(req, { error: "redirect_uri non autorisée." }, 400);
    }

    // ---- 1. URL de la boîte de dialogue Meta ---------------------------------
    if (action === "start") {
      const scopes = platform === "instagram"
        ? [...FACEBOOK_SCOPES, ...INSTAGRAM_SCOPES]
        : FACEBOOK_SCOPES;
      const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
      authUrl.searchParams.set("client_id", appId);
      authUrl.searchParams.set("redirect_uri", redirect_uri);
      authUrl.searchParams.set("scope", scopes.join(","));
      authUrl.searchParams.set("response_type", "code");
      // `state` lie la redirection à l'organisation : empêche qu'une réponse
      // Meta destinée à un client soit rejouée sur le compte d'un autre.
      authUrl.searchParams.set("state", `${orgId}:${platform}`);
      return jsonResponse(req, { auth_url: authUrl.toString() }, 200);
    }

    // ---- 2. Code -> jeton longue durée -> liste des Pages --------------------
    if (action === "exchange") {
      if (!code || typeof code !== "string") {
        return jsonResponse(req, { error: "code est obligatoire." }, 400);
      }

      const shortLived = await graphGet<{ access_token: string }>("oauth/access_token", {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri,
        code,
      });

      // Le jeton courte durée expire en ~1 h : on l'échange tout de suite
      // contre un jeton longue durée (~60 jours).
      const longLived = await graphGet<{ access_token: string; expires_in?: number }>("oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.access_token,
      });

      const pages = await graphGet<{
        data: { id: string; name: string; access_token: string;
                instagram_business_account?: { id: string; username?: string } }[];
      }>("me/accounts", {
        access_token: longLived.access_token,
        fields: "id,name,access_token,instagram_business_account{id,username}",
      });

      // On renvoie la liste des Pages SANS leurs jetons : le navigateur n'a
      // pas à les voir. Le jeton utilisateur longue durée repart en revanche,
      // pour permettre l'étape "select" sans redemander l'autorisation.
      return jsonResponse(req, {
        user_token: longLived.access_token,
        pages: pages.data.map((p) => ({
          id: p.id,
          name: p.name,
          instagram: p.instagram_business_account
            ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
            : null,
        })),
      }, 200);
    }

    // ---- 3. Enregistrement de la Page choisie --------------------------------
    if (action === "select") {
      if (!page_id || typeof page_id !== "string" || !user_token || typeof user_token !== "string") {
        return jsonResponse(req, { error: "page_id et user_token sont obligatoires." }, 400);
      }

      const pages = await graphGet<{
        data: { id: string; name: string; access_token: string;
                instagram_business_account?: { id: string; username?: string } }[];
      }>("me/accounts", {
        access_token: user_token,
        fields: "id,name,access_token,instagram_business_account{id,username}",
      });

      const page = pages.data.find((p) => p.id === page_id);
      if (!page) {
        return jsonResponse(req, { error: "Page introuvable parmi celles que vous administrez." }, 400);
      }

      const admin = serviceClient();

      // Identifiant externe et jeton diffèrent selon la plateforme visée :
      // Instagram s'adresse par l'id du compte professionnel, mais s'appelle
      // avec le jeton de la Page à laquelle il est rattaché.
      let externalId = page.id;
      let displayName = page.name;
      if (platform === "instagram") {
        if (!page.instagram_business_account) {
          return jsonResponse(req, {
            error: "Aucun compte Instagram professionnel n'est lié à cette Page. Liez-le depuis Facebook, puis réessayez.",
          }, 400);
        }
        externalId = page.instagram_business_account.id;
        displayName = page.instagram_business_account.username ?? page.name;
      }

      // Un compte externe n'appartient qu'à une organisation : si une autre
      // l'a déjà branché, on refuse plutôt que d'écraser sa connexion.
      const { data: existing } = await admin
        .from("social_connections")
        .select("org_id")
        .eq("platform", platform)
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing && existing.org_id !== orgId) {
        return jsonResponse(req, {
          error: "Ce compte est déjà connecté à une autre organisation. Déconnectez-le d'abord de celle-ci.",
        }, 409);
      }

      const { error: upsertError } = await admin
        .from("social_connections")
        .upsert({
          org_id: orgId,
          platform,
          external_id: externalId,
          secondary_id: platform === "instagram" ? page.id : null,
          display_name: displayName,
          access_token_enc: await encryptToken(page.access_token),
          scopes: platform === "instagram" ? [...FACEBOOK_SCOPES, ...INSTAGRAM_SCOPES] : FACEBOOK_SCOPES,
          // Les jetons de Page obtenus depuis un jeton utilisateur longue durée
          // n'expirent pas d'eux-mêmes, mais peuvent être révoqués à tout
          // moment. On ne pose donc pas d'échéance et on s'appuie sur le
          // passage en `status = error` au premier refus de l'API.
          expires_at: null,
          status: "active",
          last_error: null,
          connected_by: user.id,
        }, { onConflict: "platform,external_id" });

      if (upsertError) {
        console.error("connect-social upsert error:", upsertError.message);
        return jsonResponse(req, { error: "Impossible d'enregistrer la connexion." }, 500);
      }

      return jsonResponse(req, { success: true, display_name: displayName, external_id: externalId }, 200);
    }

    // ---- 4. Débranchement ----------------------------------------------------
    if (action === "disconnect") {
      const admin = serviceClient();
      const { error } = await admin
        .from("social_connections")
        .delete()
        .eq("org_id", orgId)
        .eq("platform", platform);
      if (error) {
        console.error("connect-social disconnect error:", error.message);
        return jsonResponse(req, { error: "Impossible de déconnecter le compte." }, 500);
      }
      return jsonResponse(req, { success: true }, 200);
    }

    return jsonResponse(req, { error: "action inconnue." }, 400);
  } catch (err) {
    console.error("connect-social unexpected error:", err);
    const message = err instanceof Error ? err.message : "Erreur serveur lors de la connexion du compte.";
    return jsonResponse(req, { error: message }, 500);
  }
});
