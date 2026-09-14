-- ============================================================================
-- JETON D'INGESTION PAR ORGANISATION
-- ----------------------------------------------------------------------------
-- `receive-marketing-order` s'authentifiait par MARKETING_WEBHOOK_SECRET, un
-- secret unique pour tout le deploiement. En mono-entreprise c'etait suffisant.
-- En SaaS, c'est une faille : ce secret identifie « notre n8n », pas « ce
-- client-la ». Quiconque le detient pourrait ecrire des commandes dans
-- n'importe quelle organisation.
--
-- On donne donc a chaque organisation son propre jeton. Il joue les deux roles
-- a la fois : il identifie l'organisation ET il l'authentifie. C'est ce que
-- font les webhooks de Stripe ou de GitHub par destination.
--
-- Le jeton est stocke en clair : c'est un identifiant de routage, pas un mot de
-- passe d'utilisateur, et la fonction doit pouvoir remonter de sa valeur a
-- l'organisation en une requete. Il n'est jamais expose a `authenticated`
-- (aucun GRANT sur la colonne) ; seule une fonction en service_role le lit, et
-- l'ecran de configuration le fera regenerer plutot que relire.
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN ingest_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex');

CREATE UNIQUE INDEX organizations_ingest_token_key ON public.organizations (ingest_token);

COMMENT ON COLUMN public.organizations.ingest_token IS
  'Jeton de webhook propre a l''organisation : identifie ET authentifie l''emetteur sur receive-marketing-order. A regenerer en cas de fuite.';

-- La colonne ne doit pas fuir par la policy de lecture existante, qui autorise
-- `authenticated` a lire sa propre organisation. On restreint donc les colonnes
-- lisibles au lieu de laisser un GRANT sur toute la table.
REVOKE SELECT ON public.organizations FROM authenticated;
GRANT SELECT (id, name, slug, country_code, currency, time_zone, plan, status,
              trial_ends_at, created_at, updated_at)
  ON public.organizations TO authenticated;

-- Regeneration du jeton, reservee a la direction de l'organisation.
CREATE OR REPLACE FUNCTION public.rotate_ingest_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org   uuid := private.current_org();
  v_token text;
BEGIN
  IF v_org IS NULL OR private.get_my_role() < 6 THEN
    RAISE EXCEPTION 'Reserve a la direction de l''organisation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.organizations SET ingest_token = v_token WHERE id = v_org;
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_ingest_token() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rotate_ingest_token() TO authenticated;
