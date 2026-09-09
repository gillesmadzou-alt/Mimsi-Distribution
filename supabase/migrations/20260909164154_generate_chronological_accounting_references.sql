CREATE OR REPLACE FUNCTION private.refresh_accounting_references(
  p_account_type text,
  p_year integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  account_prefix text;
BEGIN
  IF p_account_type NOT IN ('cash', 'client', 'bank') OR p_year IS NULL THEN
    RETURN;
  END IF;

  account_prefix := CASE p_account_type
    WHEN 'cash' THEN 'CAI'
    WHEN 'client' THEN 'CLI'
    WHEN 'bank' THEN 'BNQ'
  END;

  -- Serialise renumbering for one account/year. This also makes retroactive
  -- inserts deterministic when several users save at the same time.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('accounting-reference:' || p_account_type || ':' || p_year::text, 0)
  );

  WITH numbered AS (
    SELECT ae.id,
           account_prefix || '-' || p_year::text || '-' ||
           pg_catalog.lpad(pg_catalog.row_number() OVER (
             ORDER BY ae.entry_date, ae.created_at, ae.id
           )::text, 6, '0') AS generated_reference
    FROM public.accounting_entries ae
    WHERE ae.account_type = p_account_type
      AND EXTRACT(YEAR FROM ae.entry_date)::integer = p_year
  )
  UPDATE public.accounting_entries ae
  SET reference = numbered.generated_reference,
      updated_at = pg_catalog.now()
  FROM numbered
  WHERE ae.id = numbered.id
    AND ae.reference IS DISTINCT FROM numbered.generated_reference;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_accounting_references(text, integer)
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  scope record;
BEGIN
  FOR scope IN
    SELECT DISTINCT account_type, EXTRACT(YEAR FROM entry_date)::integer AS entry_year
    FROM public.accounting_entries
  LOOP
    PERFORM private.refresh_accounting_references(scope.account_type, scope.entry_year);
  END LOOP;
END;
$$;

ALTER TABLE public.accounting_entries
  ALTER COLUMN reference SET DEFAULT ('TMP-' || gen_random_uuid()::text),
  ALTER COLUMN reference SET NOT NULL;

ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_reference_unique
  UNIQUE (reference) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION private.renumber_accounting_references_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_year integer;
  new_year integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_year := EXTRACT(YEAR FROM OLD.entry_date)::integer;
    PERFORM private.refresh_accounting_references(OLD.account_type, old_year);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_year := EXTRACT(YEAR FROM NEW.entry_date)::integer;
    IF TG_OP = 'INSERT' OR NEW.account_type IS DISTINCT FROM OLD.account_type OR new_year IS DISTINCT FROM old_year THEN
      PERFORM private.refresh_accounting_references(NEW.account_type, new_year);
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.renumber_accounting_references_after_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER renumber_accounting_references
  AFTER INSERT OR DELETE OR UPDATE OF account_type, entry_date
  ON public.accounting_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.renumber_accounting_references_after_change();

COMMENT ON COLUMN public.accounting_entries.reference IS
  'Référence automatique chronologique CAI/CLI/BNQ-AAAA-NNNNNN, recalculée lors des saisies rétroactives.';
