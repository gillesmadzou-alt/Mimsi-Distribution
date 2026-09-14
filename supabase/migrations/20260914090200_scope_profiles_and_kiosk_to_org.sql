-- ============================================================================
-- SOCLE MULTI-LOCATAIRE (3/3) : les deux cas particuliers
-- ----------------------------------------------------------------------------
-- La migration 2/3 a cloisonne les 61 tables metier. Restent deux surfaces qui
-- ne rentrent pas dans le moule :
--
--   * `profiles` n'a volontairement pas d'org_id : un compte est une identite,
--     pas une donnee metier. Un meme utilisateur pourra demain appartenir a
--     plusieurs organisations. Le rattachement passe donc par `memberships`.
--
--   * la borne de pointage lit le personnel en ANONYME (role `anon`), a travers
--     la vue `kiosk_people`. Cette vue s'execute avec les droits de son
--     proprietaire -- c'est ce qui permet a `anon` de la lire alors qu'il n'a
--     aucun droit sur les tables sous-jacentes (revoques par la migration
--     20260817090000). Mais cela contourne aussi la RLS : sans ce qui suit, un
--     kiosque verrait le personnel de TOUS les locataires. C'est la fuite la
--     plus facile a manquer, et celle qu'aucune policy ne rattrape.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Aides
-- ----------------------------------------------------------------------------

-- Un utilisateur appartient-il a l'organisation courante de l'appelant ?
-- SECURITY DEFINER pour ne pas declencher la RLS de memberships depuis une
-- policy de profiles (et donc eviter toute recursion).
CREATE OR REPLACE FUNCTION private.shares_my_org(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = p_user_id
       AND m.status = 'active'
       AND m.org_id = private.current_org()
  );
$$;

REVOKE EXECUTE ON FUNCTION private.shares_my_org(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION private.shares_my_org(uuid) TO authenticated;

-- Organisation servie par une borne de pointage anonyme.
-- La borne posera `app.kiosk_org` (identifiant de l'organisation encode dans
-- son URL). Tant qu'elle ne le fait pas, repli sur l'unique organisation --
-- meme filet temporaire que `private.set_org_id()`, qui cesse de s'appliquer
-- des la deuxieme organisation. Le kiosque ne voit alors plus rien du tout
-- (fermeture par defaut) plutot que les donnees d'un autre client.
CREATE OR REPLACE FUNCTION private.kiosk_org()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT o.id FROM public.organizations o
       WHERE o.id = NULLIF(current_setting('app.kiosk_org', true), '')::uuid
         AND o.status = 'active'
    ),
    (SELECT o.id FROM public.organizations o
      WHERE (SELECT count(*) FROM public.organizations) = 1)
  );
$$;

REVOKE EXECUTE ON FUNCTION private.kiosk_org() FROM public;
GRANT EXECUTE ON FUNCTION private.kiosk_org() TO anon, authenticated;

COMMENT ON FUNCTION private.kiosk_org() IS
  'Organisation servie par la borne de pointage anonyme, via le reglage app.kiosk_org.';

-- ----------------------------------------------------------------------------
-- profiles : cloisonnement par appartenance
-- ----------------------------------------------------------------------------
-- On voit son propre profil, et ceux des membres de son organisation.
DROP POLICY IF EXISTS profiles_tenant_isolation ON public.profiles;
CREATE POLICY profiles_tenant_isolation ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (id = auth.uid() OR private.shares_my_org(id))
  WITH CHECK (id = auth.uid() OR private.shares_my_org(id));

-- ----------------------------------------------------------------------------
-- Borne de pointage : cloisonnement des lectures anonymes
-- ----------------------------------------------------------------------------
-- `anon` n'a aujourd'hui aucun droit sur ces tables : les policies qui suivent
-- ne servent donc a rien dans l'immediat. On les pose quand meme, pour que le
-- cloisonnement soit deja en place si un GRANT venait a etre reintroduit.
DROP POLICY IF EXISTS profiles_kiosk_isolation ON public.profiles;
CREATE POLICY profiles_kiosk_isolation ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = profiles.id
       AND m.status = 'active'
       AND m.org_id = private.kiosk_org()
  ));

DO $kiosk$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['drivers', 'bakers', 'kneaders', 'attendance_records'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_kiosk_isolation', v_table);
    EXECUTE format($ddl$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO anon
        USING (org_id = private.kiosk_org())
        WITH CHECK (org_id = private.kiosk_org())
    $ddl$, v_table || '_kiosk_isolation', v_table);
  END LOOP;
END
$kiosk$;

-- ----------------------------------------------------------------------------
-- La vue du kiosque : le filtrage doit etre dans la vue elle-meme
-- ----------------------------------------------------------------------------
-- On ne peut pas basculer la vue en `security_invoker` : `anon` n'a aucun droit
-- sur profiles/drivers/bakers/kneaders, la lecture echouerait et le pointage
-- serait casse. La vue reste donc executee par son proprietaire, et c'est sa
-- definition qui porte le cloisonnement, via `private.kiosk_org()`.
--
-- Seule la clause de filtrage change ; les colonnes, la deduplication par nom
-- et l'ordre de priorite sont repris a l'identique.
CREATE OR REPLACE VIEW public.kiosk_people
WITH (security_barrier = true) AS
  WITH people AS (
    SELECT p.id, p.full_name, p.role, 'profile'::text AS person_type, 1 AS source_priority
      FROM public.profiles p
     WHERE p.is_active = true
       AND EXISTS (
         SELECT 1 FROM public.memberships m
          WHERE m.user_id = p.id AND m.status = 'active'
            AND m.org_id = private.kiosk_org()
       )
    UNION ALL
    SELECT d.id, d.full_name, 10 AS role, 'driver'::text, 2
      FROM public.drivers d
     WHERE d.status = 'actif' AND d.org_id = private.kiosk_org()
    UNION ALL
    SELECT b.id, b.full_name, 9 AS role, 'baker'::text, 3
      FROM public.bakers b
     WHERE b.status = 'actif' AND b.org_id = private.kiosk_org()
    UNION ALL
    SELECT k.id, k.full_name, 8 AS role, 'kneader'::text, 4
      FROM public.kneaders k
     WHERE k.status = 'actif' AND k.org_id = private.kiosk_org()
  )
  SELECT DISTINCT ON (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')))
         id, full_name, role, person_type
    FROM people
   WHERE btrim(full_name) <> ''
   ORDER BY lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')), source_priority, full_name;

COMMENT ON VIEW public.kiosk_people IS
  'Personnel visible par une borne de pointage, restreint a l''organisation designee par private.kiosk_org().';
