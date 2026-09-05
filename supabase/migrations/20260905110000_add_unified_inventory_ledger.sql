-- Registre unifié : intrants, madeleines, pots prêts, pots vides et couvercles.
CREATE TABLE IF NOT EXISTS public.inventory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on date NOT NULL DEFAULT current_date,
  item_category text NOT NULL CHECK (item_category IN ('ingredient', 'madeleine', 'ready_pot', 'empty_pot', 'lid')),
  pot_type_id uuid REFERENCES public.pot_types(id) ON DELETE SET NULL,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  operation text NOT NULL CHECK (operation IN ('initial', 'entree', 'sortie', 'retour', 'ajustement')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  delta numeric NOT NULL,
  quantity_before numeric,
  quantity_after numeric,
  source_type text,
  source_id uuid,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_entries_item_reference CHECK (
    (item_category = 'ingredient' AND ingredient_id IS NOT NULL AND pot_type_id IS NULL)
    OR (item_category <> 'ingredient' AND pot_type_id IS NOT NULL AND ingredient_id IS NULL)
  )
);

ALTER TABLE public.inventory_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_entries_select ON public.inventory_entries;
CREATE POLICY inventory_entries_select ON public.inventory_entries
  FOR SELECT TO authenticated
  USING (private.get_my_role() >= 2);

CREATE INDEX IF NOT EXISTS idx_inventory_entries_item_date
  ON public.inventory_entries (item_category, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_entries_pot_type
  ON public.inventory_entries (pot_type_id) WHERE pot_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_entries_ingredient
  ON public.inventory_entries (ingredient_id) WHERE ingredient_id IS NOT NULL;

-- The only manual stock-write entry point. It validates the user role, keeps the
-- current stock fields in sync, then writes a traceable ledger row.
CREATE OR REPLACE FUNCTION public.record_inventory_entry(
  p_item_category text,
  p_pot_type_id uuid DEFAULT NULL,
  p_ingredient_id uuid DEFAULT NULL,
  p_operation text DEFAULT 'entree',
  p_quantity numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_occurred_on date DEFAULT current_date
)
RETURNS public.inventory_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_column text;
  v_entry public.inventory_entries;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_actor AND is_active = true AND role IN (2, 4, 5, 6, 16)
  ) THEN
    RAISE EXCEPTION 'Accès non autorisé à la gestion de stock';
  END IF;

  IF p_item_category NOT IN ('ingredient', 'madeleine', 'ready_pot', 'empty_pot', 'lid')
    OR p_operation NOT IN ('initial', 'entree', 'sortie', 'retour', 'ajustement')
    OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Mouvement de stock invalide';
  END IF;

  IF p_item_category = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_pot_type_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un intrant doit être sélectionné';
    END IF;
    SELECT stock_quantity INTO v_before FROM public.ingredients WHERE id = p_ingredient_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Intrant introuvable'; END IF;
  ELSE
    IF p_pot_type_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un type de pot doit être sélectionné';
    END IF;
    v_column := CASE p_item_category
      WHEN 'ready_pot' THEN 'stock_quantity'
      WHEN 'empty_pot' THEN 'empty_pots_stock'
      WHEN 'lid' THEN 'empty_lids_stock'
      ELSE 'madeleines_stock'
    END;
    EXECUTE format('SELECT %I::numeric FROM public.pot_types WHERE id = $1 FOR UPDATE', v_column)
      INTO v_before USING p_pot_type_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Type de pot introuvable'; END IF;
  END IF;

  v_delta := CASE
    WHEN p_operation = 'initial' THEN p_quantity - v_before
    WHEN p_operation IN ('entree', 'retour') THEN p_quantity
    WHEN p_operation = 'sortie' THEN -p_quantity
    ELSE p_quantity
  END;
  v_after := v_before + v_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'Stock insuffisant pour cette sortie'; END IF;

  IF p_item_category = 'ingredient' THEN
    UPDATE public.ingredients SET stock_quantity = v_after, updated_at = now() WHERE id = p_ingredient_id;
  ELSE
    EXECUTE format('UPDATE public.pot_types SET %I = $1 WHERE id = $2', v_column)
      USING v_after, p_pot_type_id;
  END IF;

  INSERT INTO public.inventory_entries (
    occurred_on, item_category, pot_type_id, ingredient_id, operation,
    quantity, delta, quantity_before, quantity_after, notes, created_by
  ) VALUES (
    COALESCE(p_occurred_on, current_date), p_item_category, p_pot_type_id, p_ingredient_id, p_operation,
    p_quantity, v_delta, v_before, v_after, NULLIF(trim(p_notes), ''), v_actor
  ) RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.record_inventory_entry(text, uuid, uuid, text, numeric, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_inventory_entry(text, uuid, uuid, text, numeric, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_entry(text, uuid, uuid, text, numeric, text, date) TO authenticated;

-- Existing operational pages already write stock_movements. Mirror each new
-- movement in the register so Production, Tournées and Retours share one history.
CREATE OR REPLACE FUNCTION private.log_stock_movement_to_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category text;
  v_operation text;
  v_delta numeric;
BEGIN
  v_category := CASE
    WHEN lower(COALESCE(NEW.notes, '')) LIKE 'pots vides%' THEN 'empty_pot'
    WHEN lower(COALESCE(NEW.notes, '')) LIKE 'couvercles%' THEN 'lid'
    WHEN lower(COALESCE(NEW.notes, '')) LIKE 'madeleines%' OR NEW.item_type = 'madeleines' THEN 'madeleine'
    ELSE 'ready_pot'
  END;
  v_operation := CASE NEW.movement_type
    WHEN 'entree' THEN 'entree'
    WHEN 'retour' THEN 'retour'
    WHEN 'attribution' THEN 'sortie'
    ELSE 'ajustement'
  END;
  v_delta := CASE WHEN v_operation IN ('entree', 'retour') THEN NEW.quantity ELSE -NEW.quantity END;

  INSERT INTO public.inventory_entries (
    occurred_on, item_category, pot_type_id, operation, quantity, delta,
    source_type, source_id, notes, created_by
  ) VALUES (
    NEW.created_at::date, v_category, NEW.pot_type_id, v_operation, NEW.quantity, v_delta,
    'stock_movement', NEW.id, NEW.notes, NEW.created_by
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.log_stock_movement_to_inventory() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_log_stock_movement_to_inventory ON public.stock_movements;
CREATE TRIGGER trg_log_stock_movement_to_inventory
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION private.log_stock_movement_to_inventory();

-- A pâte batch consumes intrants. Recording its lines writes the corresponding
-- exits in the same ledger without changing the existing stock deduction flow.
CREATE OR REPLACE FUNCTION private.log_dough_ingredients_to_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created_by uuid;
  v_date date;
BEGIN
  SELECT created_by, batch_date INTO v_created_by, v_date
  FROM public.dough_batches WHERE id = NEW.dough_batch_id;

  INSERT INTO public.inventory_entries (
    occurred_on, item_category, ingredient_id, operation, quantity, delta,
    source_type, source_id, notes, created_by
  ) VALUES (
    COALESCE(v_date, current_date), 'ingredient', NEW.ingredient_id, 'sortie', NEW.quantity, -NEW.quantity,
    'dough_batch', NEW.dough_batch_id, 'Consommation pour fabrication de pâte', v_created_by
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.log_dough_ingredients_to_inventory() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_log_dough_ingredients_to_inventory ON public.dough_batch_ingredients;
CREATE TRIGGER trg_log_dough_ingredients_to_inventory
  AFTER INSERT ON public.dough_batch_ingredients
  FOR EACH ROW EXECUTE FUNCTION private.log_dough_ingredients_to_inventory();

ALTER TABLE public.inventory_entries REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_entries;
