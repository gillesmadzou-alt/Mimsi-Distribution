-- ============================================================================
-- CONNEXIONS SOCIALES PAR LOCATAIRE
-- ----------------------------------------------------------------------------
-- Deuxieme verrou mono-entreprise, apres l'absence d'org_id : les jetons
-- d'acces Facebook, Instagram et WhatsApp sont aujourd'hui des variables
-- d'environnement Deno (FACEBOOK_PAGE_ACCESS_TOKEN, WHATSAPP_ACCESS_TOKEN,
-- INSTAGRAM_ACCESS_TOKEN, FACEBOOK_PAGE_ID, WHATSAPP_PHONE_NUMBER_ID).
-- Une variable d'environnement vaut pour tout le deploiement : il ne peut donc
-- y avoir qu'une seule entreprise. Cette table les remplace, une ligne par
-- compte connecte et par organisation.
--
-- Chiffrement : les jetons ne sont JAMAIS stockes en clair. Ils sont chiffres
-- en AES-256-GCM par les Edge Functions (supabase/functions/_shared/crypto.ts)
-- avec la cle TOKEN_ENCRYPTION_KEY, avant d'arriver ici. La base ne voit que
-- du chiffre : une fuite de sauvegarde n'expose aucun compte client.
--
-- Routage des webhooks : Meta identifie l'emetteur par un identifiant externe
-- (page_id pour Messenger, phone_number_id pour WhatsApp, user_id Instagram).
-- L'index unique (platform, external_id) est ce qui permet de remonter de cet
-- identifiant a l'organisation, et donc de livrer l'evenement au bon client.
-- ============================================================================

CREATE TABLE public.social_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  platform           text NOT NULL
                       CHECK (platform IN ('facebook', 'instagram', 'whatsapp', 'tiktok')),

  -- Identifiant du compte chez la plateforme : page_id, ig_user_id,
  -- phone_number_id, open_id TikTok. C'est la cle de routage des webhooks.
  external_id        text NOT NULL,

  -- Identifiant secondaire, quand la plateforme en impose deux :
  -- le WABA id pour WhatsApp, l'id du compte publicitaire, etc.
  secondary_id       text,

  display_name       text,

  -- Jetons chiffres (AES-256-GCM, encodes en base64 : nonce + chiffre + tag).
  access_token_enc   text NOT NULL,
  refresh_token_enc  text,

  scopes             text[] NOT NULL DEFAULT '{}',
  expires_at         timestamptz,

  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  last_error         text,
  last_used_at       timestamptz,

  connected_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Un compte externe n'appartient qu'a une seule organisation : c'est cette
-- contrainte qui garantit qu'un webhook ne peut pas etre livre a deux clients.
CREATE UNIQUE INDEX social_connections_platform_external_key
  ON public.social_connections (platform, external_id);

-- Une organisation n'a qu'un compte actif par plateforme (pour l'instant).
CREATE UNIQUE INDEX social_connections_org_platform_active_key
  ON public.social_connections (org_id, platform)
  WHERE status = 'active';

CREATE INDEX social_connections_org_idx ON public.social_connections (org_id);
CREATE INDEX social_connections_expiring_idx
  ON public.social_connections (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TRIGGER social_connections_set_updated_at
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER social_connections_set_org_id
  BEFORE INSERT OR UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION private.set_org_id();

COMMENT ON TABLE public.social_connections IS
  'Comptes sociaux connectes, un par organisation et par plateforme. Jetons chiffres en AES-256-GCM par les Edge Functions ; la base ne voit jamais le clair.';
COMMENT ON COLUMN public.social_connections.external_id IS
  'Identifiant du compte chez la plateforme (page_id, ig_user_id, phone_number_id). Cle de routage des webhooks entrants vers la bonne organisation.';

-- ----------------------------------------------------------------------------
-- RLS : le client ne voit jamais un jeton, meme chiffre
-- ----------------------------------------------------------------------------
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

-- Supabase accorde par defaut tous les droits sur les nouvelles tables de
-- `public` a anon et authenticated (ALTER DEFAULT PRIVILEGES). Sans la
-- revocation qui suit, `access_token_enc` serait lisible par n'importe quel
-- utilisateur connecte : la RLS cloisonne par organisation, elle ne cache pas
-- une colonne a l'interieur d'une ligne qu'on a le droit de lire.
-- C'est exactement le genre de fuite qu'aucune policy ne rattrape.
REVOKE ALL ON public.social_connections FROM anon, authenticated;

-- Aucun GRANT de colonne secrete pour `authenticated` : le front n'y accede pas
-- directement. Il passe par la vue ci-dessous, qui n'expose pas les colonnes
-- de jetons. Les Edge Functions, en service_role, lisent la table.
CREATE POLICY social_connections_tenant_isolation ON public.social_connections
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (org_id = private.current_org())
  WITH CHECK (org_id = private.current_org());

-- Vue de consultation pour l'interface « Mes canaux » : l'etat de chaque
-- connexion, sans la moindre donnee secrete.
CREATE VIEW public.social_connection_status
WITH (security_barrier = true, security_invoker = true) AS
  SELECT id, org_id, platform, display_name, external_id,
         status, scopes, expires_at, last_used_at, last_error,
         (expires_at IS NOT NULL AND expires_at < now() + interval '7 days') AS expires_soon,
         created_at
    FROM public.social_connections;

GRANT SELECT ON public.social_connection_status TO authenticated;

COMMENT ON VIEW public.social_connection_status IS
  'Etat des comptes connectes pour l''ecran « Mes canaux ». N''expose aucun jeton. security_invoker : la RLS de social_connections s''applique a l''appelant.';

-- Policy de lecture permissive, requise pour que la vue en security_invoker
-- retourne quelque chose (la RESTRICTIVE ci-dessus ne fait que restreindre).
CREATE POLICY social_connections_select ON public.social_connections
  FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

GRANT SELECT (id, org_id, platform, display_name, external_id, status, scopes,
              expires_at, last_used_at, last_error, created_at)
  ON public.social_connections TO authenticated;
