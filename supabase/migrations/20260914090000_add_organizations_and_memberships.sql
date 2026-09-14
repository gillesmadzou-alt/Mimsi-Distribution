-- ============================================================================
-- SOCLE MULTI-LOCATAIRE (1/3) : organisations et appartenances
-- ----------------------------------------------------------------------------
-- Premiere brique de la transformation en SaaS. Introduit la notion de
-- locataire (une entreprise cliente = une "organization") et le lien entre un
-- utilisateur et ses organisations ("memberships").
--
-- Cette migration n'isole encore rien : elle cree les tables et le resolveur
-- `private.current_org()`. L'isolation proprement dite arrive en 2/3.
--
-- Choix de conception :
--   * `memberships` est la source de verite de l'APPARTENANCE (quel utilisateur
--     a acces a quelle organisation).
--   * L'autorisation reste inchangee. Le depot distingue deux notions :
--     `profiles.role` est la FONCTION METIER (1 a 16 : chauffeur, boulanger...)
--     et `profiles.access_level` le NIVEAU D'AUTORISATION (1 a 6), seul lu par
--     `private.get_my_role()`. Cette fonction n'est pas modifiee : les 223
--     policies existantes se comportent donc exactement comme avant.
--     `memberships` en tient un miroir, maintenu par trigger, qui servira le
--     jour ou un utilisateur appartiendra a plusieurs organisations avec un
--     niveau different dans chacune.
-- ============================================================================

CREATE TABLE public.organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL,
  country_code    text NOT NULL DEFAULT 'CG',
  currency        text NOT NULL DEFAULT 'XAF',
  time_zone       text NOT NULL DEFAULT 'Africa/Brazzaville',
  plan            text NOT NULL DEFAULT 'trial'
                    CHECK (plan IN ('trial', 'commercant', 'business', 'pro')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'cancelled')),
  trial_ends_at   timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX organizations_slug_key ON public.organizations (lower(slug));

COMMENT ON TABLE public.organizations IS
  'Locataire du SaaS : une entreprise cliente. Toute donnee metier lui est rattachee par org_id.';

CREATE TABLE public.memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_level smallint NOT NULL DEFAULT 1 CHECK (access_level BETWEEN 1 AND 6),
  job_role     smallint,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('invited', 'active', 'suspended')),
  is_default   boolean NOT NULL DEFAULT true,
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memberships_org_user_key ON public.memberships (org_id, user_id);
CREATE INDEX memberships_user_idx ON public.memberships (user_id) WHERE status = 'active';

COMMENT ON TABLE public.memberships IS
  'Appartenance d''un utilisateur a une organisation. Source de verite de l''acces ; le niveau effectif reste lu dans profiles.access_level via private.get_my_role().';

COMMENT ON COLUMN public.memberships.access_level IS
  'Miroir de profiles.access_level (1 a 6). Deviendra la source de verite quand un utilisateur pourra appartenir a plusieurs organisations.';

COMMENT ON COLUMN public.memberships.job_role IS
  'Miroir de profiles.role : la fonction metier (1 a 16), independante du niveau d''autorisation.';

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Resolveur d'organisation courante
-- ----------------------------------------------------------------------------
-- Ordre de resolution :
--   1. le reglage de session `app.current_org`, pose par l'application quand
--      l'utilisateur bascule d'organisation -- toujours VALIDE contre les
--      appartenances, donc non usurpable ;
--   2. sinon, l'appartenance active marquee par defaut ;
--   3. sinon, l'unique appartenance active.
-- Retourne NULL si l'appelant n'appartient a aucune organisation : les policies
-- d'isolation ajoutees en 2/3 refusent alors tout, ce qui est le comportement
-- voulu (fermeture par defaut).
CREATE OR REPLACE FUNCTION private.current_org()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT m.org_id FROM public.memberships m
       WHERE m.user_id = auth.uid()
         AND m.status = 'active'
         AND m.org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
       LIMIT 1
    ),
    (
      SELECT m.org_id FROM public.memberships m
       WHERE m.user_id = auth.uid()
         AND m.status = 'active'
         AND m.is_default
       ORDER BY m.created_at
       LIMIT 1
    ),
    (
      SELECT m.org_id FROM public.memberships m
       WHERE m.user_id = auth.uid()
         AND m.status = 'active'
       ORDER BY m.created_at
       LIMIT 1
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION private.current_org() FROM anon, public;
GRANT EXECUTE ON FUNCTION private.current_org() TO authenticated;

COMMENT ON FUNCTION private.current_org() IS
  'Organisation de l''appelant. Utilisee par les policies d''isolation. NULL si aucune appartenance active : tout est alors refuse.';

-- Toutes les organisations de l'appelant (pour le selecteur d'organisation).
CREATE OR REPLACE FUNCTION private.my_orgs()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT m.org_id FROM public.memberships m
   WHERE m.user_id = auth.uid() AND m.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION private.my_orgs() FROM anon, public;
GRANT EXECUTE ON FUNCTION private.my_orgs() TO authenticated;

-- ----------------------------------------------------------------------------
-- RLS sur les deux nouvelles tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships   ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name, country_code, currency, time_zone) ON public.organizations TO authenticated;
GRANT SELECT ON public.memberships TO authenticated;

-- Lecture : uniquement ses propres organisations.
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT private.my_orgs()));

-- Modification : reservee au niveau direction (role 6), et seulement sur la
-- sienne. La creation d'organisation passe par l'inscription (service_role),
-- jamais par le client : aucune policy INSERT n'est donc definie.
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = private.current_org() AND private.get_my_role() >= 6)
  WITH CHECK (id = private.current_org() AND private.get_my_role() >= 6);

-- Un membre voit les autres membres de ses organisations.
CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT private.my_orgs()));

-- ----------------------------------------------------------------------------
-- Miroir profiles -> memberships
-- ----------------------------------------------------------------------------
-- L'application ecrit le niveau et la fonction dans profiles (page Utilisateurs,
-- fonction create-user). On propage vers memberships pour qu'il n'y ait qu'un
-- seul point d'ecriture et aucune derive entre les deux tables.
CREATE OR REPLACE FUNCTION private.sync_membership_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.memberships
     SET access_level = NEW.access_level,
         job_role     = NEW.role
   WHERE user_id = NEW.id
     AND (access_level IS DISTINCT FROM NEW.access_level
       OR job_role     IS DISTINCT FROM NEW.role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_sync_membership_role
  AFTER INSERT OR UPDATE OF role, access_level ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.sync_membership_role();

-- ----------------------------------------------------------------------------
-- Amorcage : l'organisation historique
-- ----------------------------------------------------------------------------
-- Toutes les donnees existantes appartiennent a une seule entreprise. On la
-- cree et on y rattache tous les comptes existants ; la migration 2/3 y
-- rattachera les donnees.
INSERT INTO public.organizations (id, name, slug, country_code, currency, time_zone, plan, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Mimsi Distribution',
  'mimsi-distribution',
  'CG', 'XAF', 'Africa/Brazzaville',
  'pro', 'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.memberships (org_id, user_id, access_level, job_role, status, is_default, accepted_at)
SELECT '00000000-0000-4000-8000-000000000001', p.id, p.access_level, p.role, 'active', true, now()
  FROM public.profiles p
ON CONFLICT (org_id, user_id) DO NOTHING;
