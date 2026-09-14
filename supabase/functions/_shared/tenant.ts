// Resolution du locataire et de ses identifiants de connexion.
//
// Avant le passage en SaaS, chaque Edge Function lisait ses jetons dans les
// variables d'environnement : un seul jeu de secrets, donc une seule
// entreprise. Ce module les lit desormais dans `social_connections`, par
// organisation.
//
// Deux directions :
//
//   * ENTRANT (webhooks Meta) : on part de l'identifiant externe transmis par
//     Meta -- page_id, phone_number_id, ig_user_id -- pour retrouver
//     l'organisation. C'est `resolveOrgByExternalId`. Sans cela un webhook ne
//     saurait pas a quel client livrer l'evenement.
//
//   * SORTANT (publication, reponse, diffusion) : on part de l'organisation
//     pour retrouver le jeton avec lequel appeler l'API. C'est
//     `getConnection`.
//
// Repli historique : tant qu'une organisation n'a pas de ligne dans
// `social_connections`, on retombe sur les variables d'environnement, avec un
// avertissement. Rien ne casse au deploiement. Ce repli ne s'applique jamais
// quand plusieurs organisations existent : servir les secrets d'un client a un
// autre serait bien pire qu'une panne.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptToken } from "./crypto.ts";

export type Platform = "facebook" | "instagram" | "whatsapp" | "tiktok";

export type Connection = {
  orgId: string;
  platform: Platform;
  /** page_id, ig_user_id, phone_number_id... */
  externalId: string;
  /** WABA id, compte publicitaire... selon la plateforme. */
  secondaryId: string | null;
  accessToken: string;
  displayName: string | null;
  /** true quand le jeton vient des variables d'environnement historiques. */
  legacy: boolean;
};

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Nombre d'organisations existantes ; le repli historique n'a de sens qu'a 1. */
async function organizationCount(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("organizations")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error("tenant: impossible de compter les organisations:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** L'unique organisation, ou null s'il y en a zero ou plusieurs. */
export async function soleOrgId(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from("organizations").select("id").limit(2);
  if (error || !data || data.length !== 1) return null;
  return data[0].id as string;
}

/**
 * Retrouve l'organisation propietaire d'un compte externe.
 * C'est le point d'entree du routage des webhooks : Meta ne connait que ses
 * propres identifiants, l'index unique (platform, external_id) fait le reste.
 */
export async function resolveOrgByExternalId(
  client: SupabaseClient,
  platform: Platform,
  externalId: string | null,
): Promise<string | null> {
  if (externalId) {
    const { data, error } = await client
      .from("social_connections")
      .select("org_id")
      .eq("platform", platform)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) {
      console.error("tenant: echec de resolution de l'organisation:", error.message);
    } else if (data) {
      return data.org_id as string;
    }
  }

  // Repli historique : une seule organisation, comptes pas encore enregistres.
  const sole = await soleOrgId(client);
  if (sole) {
    console.warn(
      `tenant: aucune connexion ${platform} pour l'identifiant externe ${externalId ?? "(absent)"}, ` +
        "repli sur l'unique organisation. A corriger avant le deuxieme locataire.",
    );
    return sole;
  }

  console.error(
    `tenant: evenement ${platform} ignore, identifiant externe ${externalId ?? "(absent)"} inconnu ` +
      "et plusieurs organisations existent. Enregistrer le compte dans social_connections.",
  );
  return null;
}

/** Variables d'environnement historiques, par plateforme. */
function legacyEnvConnection(orgId: string, platform: Platform): Connection | null {
  if (platform === "facebook") {
    const token = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
    const pageId = Deno.env.get("FACEBOOK_PAGE_ID");
    if (!token) return null;
    return { orgId, platform, externalId: pageId ?? "", secondaryId: null, accessToken: token, displayName: null, legacy: true };
  }
  if (platform === "instagram") {
    const token = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    if (!token) return null;
    return { orgId, platform, externalId: "", secondaryId: null, accessToken: token, displayName: null, legacy: true };
  }
  if (platform === "whatsapp") {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (!token || !phoneNumberId) return null;
    return { orgId, platform, externalId: phoneNumberId, secondaryId: null, accessToken: token, displayName: null, legacy: true };
  }
  return null;
}

/**
 * Les identifiants d'une organisation pour une plateforme donnee.
 * Retourne null si le compte n'est pas connecte : l'appelant doit alors
 * renvoyer une erreur explicite, jamais echouer silencieusement.
 */
export async function getConnection(
  client: SupabaseClient,
  orgId: string,
  platform: Platform,
): Promise<Connection | null> {
  const { data, error } = await client
    .from("social_connections")
    .select("external_id, secondary_id, access_token_enc, display_name, status")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error(`tenant: lecture de la connexion ${platform} impossible:`, error.message);
  }

  if (data) {
    try {
      return {
        orgId,
        platform,
        externalId: data.external_id as string,
        secondaryId: (data.secondary_id as string | null) ?? null,
        accessToken: await decryptToken(data.access_token_enc as string),
        displayName: (data.display_name as string | null) ?? null,
        legacy: false,
      };
    } catch (err) {
      // Un jeton indechiffrable signale une cle changee ou une ligne corrompue.
      // On marque la connexion pour que l'ecran « Mes canaux » invite a la
      // reconnexion, plutot que de laisser une panne muette.
      console.error(`tenant: dechiffrement du jeton ${platform} impossible:`, err);
      await client
        .from("social_connections")
        .update({ status: "error", last_error: "Jeton indechiffrable : verifier TOKEN_ENCRYPTION_KEY." })
        .eq("org_id", orgId)
        .eq("platform", platform);
      return null;
    }
  }

  // Repli historique, uniquement s'il n'y a qu'une organisation.
  if ((await organizationCount(client)) === 1) {
    const legacy = legacyEnvConnection(orgId, platform);
    if (legacy) {
      console.warn(
        `tenant: connexion ${platform} absente de social_connections, repli sur les variables ` +
          "d'environnement. A migrer avant le deuxieme locataire.",
      );
      return legacy;
    }
  }

  return null;
}

/** Message d'erreur homogene quand un canal n'est pas connecte. */
export function notConnectedError(platform: Platform): string {
  const label = { facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp", tiktok: "TikTok" }[platform];
  return `Aucun compte ${label} connecte pour cette organisation. Connectez-le depuis la page Marketing › Mes canaux.`;
}

/**
 * Organisation de l'utilisateur qui appelle la fonction.
 *
 * A utiliser avec le client construit sur le JWT de l'appelant (pas le client
 * service_role) : la RLS de `memberships` garantit alors qu'on ne lit que ses
 * propres appartenances, donc qu'un appelant ne peut pas se faire passer pour
 * membre d'une autre organisation.
 *
 * C'est cette valeur qui doit filtrer TOUTES les ecritures faites ensuite en
 * service_role : ce client-la contourne la RLS, et sans le filtre un appelant
 * pourrait agir sur les donnees d'un autre client en devinant un identifiant.
 */
export async function callerOrgId(
  callerClient: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await callerClient
    .from("memberships")
    .select("org_id, is_default")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("tenant: lecture de l'appartenance impossible:", error.message);
    return null;
  }
  return (data?.org_id as string | undefined) ?? null;
}

/** Message d'erreur homogene quand l'appelant n'a pas d'organisation active. */
export const NO_ORG_ERROR =
  "Votre compte n'est rattache a aucune organisation active. Contactez un administrateur.";
