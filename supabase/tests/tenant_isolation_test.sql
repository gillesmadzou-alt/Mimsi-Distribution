-- ============================================================================
-- TEST D'ISOLATION MULTI-LOCATAIRE
-- ----------------------------------------------------------------------------
-- A executer apres chaque migration touchant au schema ou aux policies.
-- Le test cree une deuxieme organisation, un utilisateur dans chacune, des
-- donnees dans chacune, puis verifie qu'aucune ligne ne franchit la frontiere.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation_test.sql
--
-- Le script echoue bruyamment a la premiere fuite et ne laisse aucune trace
-- (tout est annule en fin de transaction).
-- ============================================================================

BEGIN;

DO $t$
DECLARE
  v_org_a   constant uuid := '00000000-0000-4000-8000-000000000001';  -- organisation historique
  v_org_b   uuid;
  v_user_a  uuid;
  v_user_b  uuid;
  v_table   text;
  v_missing text[] := '{}';
  v_n       integer;
  v_leaks   text[] := '{}';
  v_check   uuid;
BEGIN
  -- ==========================================================================
  -- 1. VERIFICATIONS STRUCTURELLES : aucune table metier ne doit passer entre
  --    les mailles. C'est ce controle qui attrapera une future table ajoutee
  --    sans org_id.
  -- ==========================================================================
  FOR v_table IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('profiles', 'organizations', 'memberships')
     ORDER BY tablename
  LOOP
    -- colonne org_id presente et NOT NULL
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table
         AND column_name = 'org_id' AND is_nullable = 'NO'
    ) THEN
      v_missing := v_missing || (v_table || ' : org_id absent ou nullable');
    END IF;

    -- policy RESTRICTIVE d'isolation presente
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_table
         AND permissive = 'RESTRICTIVE'
         AND policyname = v_table || '_tenant_isolation'
    ) THEN
      v_missing := v_missing || (v_table || ' : policy d''isolation absente');
    END IF;

    -- trigger de remplissage automatique present
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = v_table || '_set_org_id' AND NOT tgisinternal
    ) THEN
      v_missing := v_missing || (v_table || ' : trigger set_org_id absent');
    END IF;

    -- RLS active
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity
    ) THEN
      v_missing := v_missing || (v_table || ' : RLS desactivee');
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION E'Cloisonnement incomplet sur % point(s) :\n  %',
      array_length(v_missing, 1), array_to_string(v_missing, E'\n  ');
  END IF;
  RAISE NOTICE 'OK  structure : les 61 tables metier ont org_id NOT NULL, l''isolation et le trigger.';

  -- ==========================================================================
  -- 2. MISE EN PLACE : une deuxieme organisation, un utilisateur de chaque cote
  -- ==========================================================================
  INSERT INTO public.organizations (name, slug, plan, status)
  VALUES ('Boutique Test', 'boutique-test', 'commercant', 'active')
  RETURNING id INTO v_org_b;

  INSERT INTO auth.users (email) VALUES ('alice@mimsi.test') RETURNING id INTO v_user_a;
  INSERT INTO auth.users (email) VALUES ('bob@boutique.test') RETURNING id INTO v_user_b;

  -- `profiles` n'a pas d'org_id : on pose donc explicitement l'organisation
  -- ambiante avant chaque insertion, comme le ferait une session d'administrateur
  -- connecte. Sans cela, le journal d'audit declenche en cascade ne saurait pas
  -- a quel locataire rattacher son entree.
  PERFORM set_config('app.ambient_org', v_org_a::text, true);
  INSERT INTO public.profiles (id, full_name, role, access_level, is_active)
  VALUES (v_user_a, 'Alice (Mimsi)', 6, 6, true);

  PERFORM set_config('app.ambient_org', v_org_b::text, true);
  INSERT INTO public.profiles (id, full_name, role, access_level, is_active)
  VALUES (v_user_b, 'Bob (Boutique)', 6, 6, true);

  INSERT INTO public.memberships (org_id, user_id, access_level, job_role, status, accepted_at)
  VALUES (v_org_a, v_user_a, 6, 6, 'active', now()),
         (v_org_b, v_user_b, 6, 6, 'active', now());

  -- Donnees de part et d'autre. On ecrit ici en tant que proprietaire : le but
  -- est de preparer le terrain, pas de tester l'ecriture.
  INSERT INTO public.sales_points (name, org_id) VALUES
    ('Point Mimsi', v_org_a), ('Point Boutique', v_org_b);
  INSERT INTO public.suppliers (last_name, first_name, supplier_code, created_by, org_id) VALUES
    ('Mimsi', 'Fournisseur', 'F-MIM-1', v_user_a, v_org_a),
    ('Boutique', 'Fournisseur', 'F-BOU-1', v_user_b, v_org_b);
  INSERT INTO public.marketing_orders (channel, customer_name, org_id) VALUES
    ('whatsapp', 'Client Mimsi', v_org_a), ('facebook', 'Client Boutique', v_org_b);
  INSERT INTO public.drivers (full_name, phone_primary, org_id) VALUES
    ('Chauffeur Mimsi', '+242000000001', v_org_a), ('Chauffeur Boutique', '+242000000002', v_org_b);
  PERFORM set_config('app.ambient_org', '', true);

  -- ==========================================================================
  -- 3. LECTURE : Alice ne doit rien voir de la Boutique
  -- ==========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  FOREACH v_table IN ARRAY ARRAY['sales_points', 'suppliers', 'marketing_orders', 'drivers'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id <> %L', v_table, v_org_a) INTO v_n;
    IF v_n > 0 THEN
      v_leaks := v_leaks || format('%s : %s ligne(s) d''un autre locataire visibles en lecture', v_table, v_n);
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_n;
    IF v_n = 0 THEN
      v_leaks := v_leaks || format('%s : Alice ne voit meme plus ses propres lignes (isolation trop stricte)', v_table);
    END IF;
  END LOOP;

  -- profiles : Alice voit le sien, pas celui de Bob
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_user_b;
  IF v_n > 0 THEN
    v_leaks := v_leaks || 'profiles : le profil d''un autre locataire est visible';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_user_a;
  IF v_n = 0 THEN
    v_leaks := v_leaks || 'profiles : Alice ne voit plus son propre profil';
  END IF;

  -- organisations : Alice ne voit que la sienne
  SELECT count(*) INTO v_n FROM public.organizations WHERE id = v_org_b;
  IF v_n > 0 THEN
    v_leaks := v_leaks || 'organizations : une organisation etrangere est visible';
  END IF;

  RESET ROLE;
  IF array_length(v_leaks, 1) > 0 THEN
    RAISE EXCEPTION E'FUITE EN LECTURE sur % point(s) :\n  %',
      array_length(v_leaks, 1), array_to_string(v_leaks, E'\n  ');
  END IF;
  RAISE NOTICE 'OK  lecture : aucune ligne d''un autre locataire n''est visible.';

  -- ==========================================================================
  -- 4. ECRITURE : Alice ne doit pas pouvoir ecrire chez la Boutique
  -- ==========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SET LOCAL ROLE authenticated;

  -- 4a. Insertion explicite dans l'organisation d'en face : doit echouer.
  BEGIN
    INSERT INTO public.sales_points (name, org_id) VALUES ('Intrusion', v_org_b);
    RESET ROLE;
    RAISE EXCEPTION 'FUITE EN ECRITURE : insertion acceptee dans une organisation etrangere.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- comportement attendu
  END;

  -- 4b. Insertion sans org_id : doit atterrir dans l'organisation d'Alice.
  SET LOCAL ROLE authenticated;
  INSERT INTO public.sales_points (name) VALUES ('Point sans org_id');
  SELECT org_id INTO v_check FROM public.sales_points WHERE name = 'Point sans org_id';
  IF v_check IS DISTINCT FROM v_org_a THEN
    RESET ROLE;
    RAISE EXCEPTION 'Le trigger set_org_id n''a pas rattache la ligne a l''organisation de l''appelant (obtenu : %).', v_check;
  END IF;

  -- 4c. Mise a jour d'une ligne d'en face : ne doit toucher aucune ligne.
  UPDATE public.suppliers SET last_name = 'Detourne' WHERE org_id = v_org_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FUITE EN ECRITURE : % ligne(s) d''un autre locataire modifiee(s).', v_n;
  END IF;

  -- 4d. Suppression d'une ligne d'en face : idem.
  DELETE FROM public.marketing_orders WHERE org_id = v_org_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FUITE EN ECRITURE : % ligne(s) d''un autre locataire supprimee(s).', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'OK  ecriture : ni insertion, ni modification, ni suppression hors de son organisation.';

  -- ==========================================================================
  -- 5. BORNE DE POINTAGE ANONYME : le cas le plus facile a manquer
  -- ==========================================================================
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('app.kiosk_org', v_org_b::text, true);
  SET LOCAL ROLE anon;

  -- Le kiosque n'a aucun droit sur les tables : sa seule surface est la vue.
  SELECT count(*) INTO v_n FROM public.kiosk_people WHERE full_name LIKE '%Mimsi%';
  IF v_n > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FUITE KIOSQUE : un kiosque de la Boutique voit % personne(s) de Mimsi.', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.kiosk_people WHERE full_name LIKE '%Boutique%';
  IF v_n = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Le kiosque ne voit plus le personnel de sa propre organisation.';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'OK  kiosque : un kiosque anonyme ne voit que le personnel de son organisation.';

  -- ==========================================================================
  -- 6. CONNEXIONS SOCIALES : ni jeton, ni compte d'un autre locataire
  -- ==========================================================================
  INSERT INTO public.social_connections
    (org_id, platform, external_id, display_name, access_token_enc)
  VALUES
    (v_org_a, 'facebook', 'page-mimsi-123',    'Page Mimsi',    'chiffre-mimsi'),
    (v_org_b, 'facebook', 'page-boutique-456', 'Page Boutique', 'chiffre-boutique');

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SET LOCAL ROLE authenticated;

  -- Le compte de l'autre organisation est invisible.
  SELECT count(*) INTO v_n FROM public.social_connection_status WHERE org_id <> v_org_a;
  IF v_n > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FUITE : % connexion(s) sociale(s) d''un autre locataire visibles.', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.social_connection_status WHERE org_id = v_org_a;
  IF v_n = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Alice ne voit plus ses propres connexions sociales.';
  END IF;

  -- Le jeton n'est jamais lisible, meme chiffre, meme sur sa propre connexion.
  BEGIN
    PERFORM access_token_enc FROM public.social_connections WHERE org_id = v_org_a;
    RESET ROLE;
    RAISE EXCEPTION 'FUITE : le jeton chiffre est lisible par un utilisateur authentifie.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- comportement attendu : aucun GRANT sur cette colonne
  END;

  -- Le jeton d'ingestion ne doit pas non plus fuir par la table organizations.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM ingest_token FROM public.organizations WHERE id = v_org_a;
    RESET ROLE;
    RAISE EXCEPTION 'FUITE : le jeton d''ingestion est lisible par un utilisateur authentifie.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- comportement attendu
  END;

  RESET ROLE;
  RAISE NOTICE 'OK  connexions : aucun compte etranger visible, aucun jeton lisible.';

  RAISE NOTICE '--------------------------------------------------';
  RAISE NOTICE 'ISOLATION MULTI-LOCATAIRE : TOUS LES CONTROLES PASSENT';
END
$t$;

ROLLBACK;
