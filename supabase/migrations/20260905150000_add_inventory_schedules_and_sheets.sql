-- Programmation des inventaires et fiches de comptage.
CREATE TABLE IF NOT EXISTS public.inventory_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('quotidien', 'hebdomadaire', 'mensuel')),
  next_inventory_on date NOT NULL,
  categories text[] NOT NULL DEFAULT ARRAY['ingredient','madeleine','ready_pot','empty_pot','lid'],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.inventory_schedules(id) ON DELETE SET NULL,
  inventory_date date NOT NULL,
  status text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','valide')),
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_session_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  item_category text NOT NULL CHECK (item_category IN ('ingredient','madeleine','ready_pot','empty_pot','lid')),
  pot_type_id uuid REFERENCES public.pot_types(id) ON DELETE SET NULL,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  theoretical_quantity numeric NOT NULL,
  counted_quantity numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_session_lines_item_reference CHECK ((item_category = 'ingredient' AND ingredient_id IS NOT NULL AND pot_type_id IS NULL) OR (item_category <> 'ingredient' AND pot_type_id IS NOT NULL AND ingredient_id IS NULL))
);

ALTER TABLE public.inventory_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_session_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_schedules_read ON public.inventory_schedules FOR SELECT TO authenticated USING (private.get_my_role() >= 2);
CREATE POLICY inventory_schedules_write ON public.inventory_schedules FOR ALL TO authenticated USING (private.get_my_role() = ANY (ARRAY[2,4,5,6,16])) WITH CHECK (private.get_my_role() = ANY (ARRAY[2,4,5,6,16]));
CREATE POLICY inventory_sessions_read ON public.inventory_sessions FOR SELECT TO authenticated USING (private.get_my_role() >= 2);
CREATE POLICY inventory_sessions_write ON public.inventory_sessions FOR ALL TO authenticated USING (private.get_my_role() = ANY (ARRAY[2,4,5,6,16])) WITH CHECK (private.get_my_role() = ANY (ARRAY[2,4,5,6,16]));
CREATE POLICY inventory_session_lines_read ON public.inventory_session_lines FOR SELECT TO authenticated USING (private.get_my_role() >= 2);
CREATE POLICY inventory_session_lines_write ON public.inventory_session_lines FOR ALL TO authenticated USING (private.get_my_role() = ANY (ARRAY[2,4,5,6,16])) WITH CHECK (private.get_my_role() = ANY (ARRAY[2,4,5,6,16]));

CREATE OR REPLACE FUNCTION public.create_inventory_session(p_schedule_id uuid, p_inventory_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := auth.uid(); v_session uuid; v_categories text[];
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor AND is_active AND role IN (2,4,5,6,16)) THEN RAISE EXCEPTION 'Accès non autorisé'; END IF;
  SELECT categories INTO v_categories FROM public.inventory_schedules WHERE id = p_schedule_id AND is_active;
  IF v_categories IS NULL THEN RAISE EXCEPTION 'Programme d''inventaire introuvable'; END IF;
  INSERT INTO public.inventory_sessions(schedule_id, inventory_date, created_by) VALUES (p_schedule_id, COALESCE(p_inventory_date,current_date), v_actor) RETURNING id INTO v_session;
  INSERT INTO public.inventory_session_lines(session_id,item_category,ingredient_id,theoretical_quantity)
    SELECT v_session,'ingredient',id,stock_quantity FROM public.ingredients WHERE is_active AND 'ingredient' = ANY(v_categories);
  INSERT INTO public.inventory_session_lines(session_id,item_category,pot_type_id,theoretical_quantity)
    SELECT v_session,'ready_pot',id,stock_quantity FROM public.pot_types WHERE is_active AND 'ready_pot' = ANY(v_categories);
  INSERT INTO public.inventory_session_lines(session_id,item_category,pot_type_id,theoretical_quantity)
    SELECT v_session,'empty_pot',id,empty_pots_stock FROM public.pot_types WHERE is_active AND 'empty_pot' = ANY(v_categories);
  INSERT INTO public.inventory_session_lines(session_id,item_category,pot_type_id,theoretical_quantity)
    SELECT v_session,'lid',id,empty_lids_stock FROM public.pot_types WHERE is_active AND 'lid' = ANY(v_categories);
  INSERT INTO public.inventory_session_lines(session_id,item_category,pot_type_id,theoretical_quantity)
    SELECT v_session,'madeleine',id,madeleines_stock FROM public.pot_types WHERE is_active AND 'madeleine' = ANY(v_categories);
  RETURN v_session;
END; $$;
REVOKE ALL ON FUNCTION public.create_inventory_session(uuid,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_inventory_session(uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_session(uuid,date) TO authenticated;
