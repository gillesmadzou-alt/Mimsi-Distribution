CREATE OR REPLACE FUNCTION private.capture_business_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_data jsonb;
  old_data jsonb;
  actor_id uuid;
  actor_name text;
  entity_uuid uuid;
  entity_label text;
  changed_fields jsonb;
  action_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  old_data := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  actor_id := auth.uid();

  IF actor_id IS NOT NULL THEN
    SELECT profile.full_name INTO actor_name
    FROM public.profiles AS profile
    WHERE profile.id = actor_id;
  END IF;

  IF coalesce(row_data ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    entity_uuid := (row_data ->> 'id')::uuid;
  END IF;

  entity_label := coalesce(
    row_data ->> 'name', row_data ->> 'full_name', row_data ->> 'title',
    row_data ->> 'label', row_data ->> 'code', row_data ->> 'reference',
    row_data ->> 'id'
  );
  action_name := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'update'
    WHEN 'DELETE' THEN 'delete'
  END;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(jsonb_agg(key ORDER BY key), '[]'::jsonb)
      INTO changed_fields
    FROM jsonb_each(row_data) AS current_value(key, value)
    WHERE old_data -> current_value.key IS DISTINCT FROM current_value.value;
  ELSE
    changed_fields := '[]'::jsonb;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (
      action, entity_type, entity_id, entity_label,
      performed_by, performed_by_name, details
    ) VALUES (
      action_name, TG_TABLE_NAME, entity_uuid, entity_label,
      CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = actor_id)
        THEN actor_id ELSE NULL END,
      coalesce(actor_name, CASE WHEN actor_id IS NULL THEN 'Système' ELSE 'Utilisateur' END),
      jsonb_build_object('changed_fields', changed_fields)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit capture failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_business_action() FROM PUBLIC;

DO $$
DECLARE
  target_table record;
BEGIN
  FOR target_table IN
    SELECT c.oid::regclass AS qualified_name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN (
        'audit_logs', 'app_notifications', 'driver_locations',
        'compliance_audit_trail'
      )
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_capture_business_action ON %s',
      target_table.qualified_name
    );
    EXECUTE format(
      'CREATE TRIGGER trg_capture_business_action AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION private.capture_business_action()',
      target_table.qualified_name
    );
  END LOOP;
END;
$$;
