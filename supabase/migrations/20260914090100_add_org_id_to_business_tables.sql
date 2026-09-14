-- ============================================================================
-- SOCLE MULTI-LOCATAIRE (2/3) : cloisonnement des donnees metier
-- ----------------------------------------------------------------------------
-- Ajoute `org_id` a chacune des 61 tables metier, rattache l'existant a
-- l'organisation historique, puis pose l'isolation.
--
-- Methode retenue pour l'isolation : une policy RESTRICTIVE par table.
-- ----------------------------------------------------------------------------
-- Postgres evalue une ligne ainsi :
--     (au moins une policy PERMISSIVE passe)  ET  (toutes les RESTRICTIVE passent)
-- Les 223 policies existantes sont toutes PERMISSIVE. Ajouter une policy
-- RESTRICTIVE « org_id = private.current_org() » revient donc a ajouter un ET
-- a chacune d'elles, SANS EN REECRIRE UNE SEULE. C'est a la fois beaucoup plus
-- sur (aucune regle de role n'est modifiee, donc aucune regression possible sur
-- les droits existants) et beaucoup plus court qu'une reecriture manuelle.
--
-- Rappel important : `service_role` possede BYPASSRLS. Les Edge Functions qui
-- l'utilisent ne sont PAS protegees par ces policies et doivent filtrer sur
-- org_id explicitement. Voir la note en fin de fichier.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Remplissage automatique de org_id, et heritage par les triggers metier
-- ----------------------------------------------------------------------------
-- Ordre de resolution a l'insertion :
--   1. l'org_id explicitement fourni (Edge Functions qui savent pour quel
--      locataire elles ecrivent) ;
--   2. l'organisation de l'appelant authentifie ;
--   3. l'organisation « ambiante » de la transaction (voir ci-dessous) ;
--   4. filet temporaire : l'unique organisation, s'il n'y en a qu'une.
--
-- Le point 3 merite une explication. Une trentaine de triggers metier ecrivent
-- en cascade d'une table vers une autre : creer un point de vente insere une
-- ecriture comptable, confirmer un depot cree une creance, un mouvement de
-- stock alimente l'inventaire, et `capture_business_action` journalise tout
-- dans audit_logs. Ces fonctions ne transmettent evidemment pas d'org_id --
-- elles ont ete ecrites avant l'existence de la notion.
--
-- Plutot que de reecrire ces trente fonctions metier (et de risquer une
-- regression sur la comptabilite ou les stocks), on memorise l'organisation de
-- la ligne en cours de traitement dans un reglage local a la transaction. Les
-- insertions declenchees en cascade en heritent. Le trigger etant pose sur
-- toutes les tables, la chaine se propage d'elle-meme, quelle que soit sa
-- profondeur.
--
-- Le trigger couvre aussi l'UPDATE, pour deux raisons : alimenter l'ambiance
-- quand une mise a jour declenche une insertion en cascade, et interdire le
-- deplacement d'une ligne d'un locataire vers un autre.
CREATE OR REPLACE FUNCTION private.set_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org   uuid;
  v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Une ligne ne change jamais de locataire.
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION
        'Changement d''organisation interdit sur % (% -> %).',
        TG_TABLE_NAME, OLD.org_id, NEW.org_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM set_config('app.ambient_org', NEW.org_id::text, true);
    RETURN NEW;
  END IF;

  IF NEW.org_id IS NULL THEN
    NEW.org_id := private.current_org();
  END IF;

  IF NEW.org_id IS NULL THEN
    NEW.org_id := NULLIF(current_setting('app.ambient_org', true), '')::uuid;
  END IF;

  IF NEW.org_id IS NULL THEN
    SELECT count(*) INTO v_count FROM public.organizations;
    IF v_count = 1 THEN
      SELECT id INTO v_org FROM public.organizations;
      RAISE WARNING
        'org_id absent sur %, repli sur l''unique organisation %. A corriger avant le deuxieme locataire.',
        TG_TABLE_NAME, v_org;
      NEW.org_id := v_org;
    END IF;
  END IF;

  IF NEW.org_id IS NULL THEN
    RAISE EXCEPTION
      'Impossible de determiner l''organisation pour une insertion dans %. '
      'L''appelant n''a pas d''appartenance active et org_id n''a pas ete fourni.',
      TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Les insertions declenchees en cascade par cette ligne heriteront de ceci.
  PERFORM set_config('app.ambient_org', NEW.org_id::text, true);
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION private.set_org_id() FROM anon, public;

DO $migration$
DECLARE
  v_table   text;
  v_org     constant uuid := '00000000-0000-4000-8000-000000000001';
  v_tables  constant text[] := ARRAY[
  'accounting_entries',
  'app_notifications',
  'attendance_records',
  'audit_logs',
  'auto_reply_settings',
  'bakers',
  'barcodes',
  'batch_pot_types',
  'batch_sales_points',
  'broadcasts',
  'compliance_audit_trail',
  'compliance_checks',
  'compliance_comments',
  'compliance_discrepancies',
  'consignment_returns',
  'consignments',
  'delivery_batch_approvals',
  'delivery_batches',
  'delivery_events',
  'delivery_expenses',
  'deposit_barcodes',
  'deposits',
  'documents',
  'dough_batch_ingredients',
  'dough_batches',
  'dough_deliveries',
  'driver_location_history',
  'driver_locations',
  'drivers',
  'equipment_assets',
  'facebook_comments',
  'facebook_posts',
  'facebook_stories',
  'field_observation_comments',
  'field_observations',
  'ingredients',
  'inventory_entries',
  'inventory_schedules',
  'inventory_session_lines',
  'inventory_sessions',
  'kneaders',
  'leave_periods',
  'marketing_orders',
  'opportunistic_sales',
  'payment_requests',
  'personnel_change_requests',
  'pot_types',
  'production_records',
  'qr_codes',
  'quota_payments',
  'receivable_payments',
  'receivables',
  'restock_requests',
  'return_pot_types',
  'returns',
  'sales_points',
  'stock_handovers',
  'stock_movements',
  'suppliers',
  'wedding_orders',
  'work_schedules'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP

    -- 1. La colonne, d'abord nullable pour pouvoir rattacher l'existant.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE',
      v_table);

    -- 2. Rattachement des lignes existantes a l'organisation historique.
    EXECUTE format('UPDATE public.%I SET org_id = %L WHERE org_id IS NULL', v_table, v_org);

    -- 3. Verrouillage : plus aucune ligne sans locataire.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET NOT NULL', v_table);

    -- 4. Index : chaque requete filtrera desormais sur org_id.
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)',
                   v_table || '_org_id_idx', v_table);

    -- 5. Remplissage automatique a l'insertion. L'org_id n'est jamais fourni
    --    par le client : il est impose ici. Le code applicatif existant
    --    continue donc de fonctionner sans modification.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                   v_table || '_set_org_id', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.set_org_id()',
      v_table || '_set_org_id', v_table);

    -- 6. L'isolation elle-meme.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_isolation', v_table);
    EXECUTE format($ddl$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING (org_id = private.current_org())
        WITH CHECK (org_id = private.current_org())
    $ddl$, v_table || '_tenant_isolation', v_table);

  END LOOP;
END
$migration$;

-- ----------------------------------------------------------------------------
-- Note de suivi : les Edge Functions
-- ----------------------------------------------------------------------------
-- Les fonctions qui ecrivent avec SUPABASE_SERVICE_ROLE_KEY contournent la RLS.
-- Tant qu'elles ne transmettent pas d'org_id, `private.set_org_id()` retombe
-- sur l'unique organisation existante et emet un WARNING dans les logs. Ce
-- filet disparait des la creation d'une deuxieme organisation : l'insertion
-- echouera alors franchement (org_id NOT NULL) plutot que d'ecrire chez le
-- mauvais client. Les fonctions a mettre a jour avant d'ouvrir le SaaS a un
-- deuxieme locataire :
--   receive-marketing-order, meta-webhook, send-push, broadcast-message,
--   send-payment-reminders, kiosk-checkin, create-user,
--   publish-to-facebook, publish-facebook-story, publish-facebook-video-story,
--   send-facebook-message, manage-facebook-comment,
--   initiate-mobile-money-payment, initiate-card-payment,
--   pawapay-webhook, cinetpay-webhook.
