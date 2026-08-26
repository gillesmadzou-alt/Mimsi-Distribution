CREATE OR REPLACE FUNCTION public.create_delivery_batch_bundle(
  p_batch_code text,
  p_driver_id uuid,
  p_zone text,
  p_batch_type text,
  p_sales_point_ids uuid[] DEFAULT '{}'::uuid[],
  p_pot_entries jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role integer;
  created_batch public.delivery_batches%ROWTYPE;
  pot_entry jsonb;
  pot_id uuid;
  pot_quantity integer;
  pot_name text;
  total_quantity integer := 0;
  first_pot_type uuid;
  pot_summary text;
  needs_pots boolean;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication requise.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO actor_role
  FROM public.profiles
  WHERE id = actor_id AND is_active = true;

  IF actor_role IS NULL OR actor_role NOT IN (2, 4, 5, 6, 16) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à créer une tournée.' USING ERRCODE = '42501';
  END IF;

  IF p_batch_type NOT IN ('livraison', 'recouvrement', 'mixte') THEN
    RAISE EXCEPTION 'Type de tournée invalide.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers
    WHERE id = p_driver_id AND status = 'actif'
  ) THEN
    RAISE EXCEPTION 'Commercial actif introuvable.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_sales_point_ids, 1), 0) <> (
    SELECT count(*) FROM public.sales_points
    WHERE id = ANY(coalesce(p_sales_point_ids, '{}'::uuid[])) AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Un ou plusieurs points de vente sont invalides.' USING ERRCODE = '22023';
  END IF;

  needs_pots := p_batch_type IN ('livraison', 'mixte');
  IF jsonb_typeof(p_pot_entries) <> 'array' THEN
    RAISE EXCEPTION 'La liste des pots est invalide.' USING ERRCODE = '22023';
  END IF;
  IF needs_pots AND jsonb_array_length(p_pot_entries) = 0 THEN
    RAISE EXCEPTION 'Ajoutez au moins un type de pot.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_pot_entries) entry
    GROUP BY entry ->> 'pot_type_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Un type de pot ne peut apparaître qu''une fois.' USING ERRCODE = '22023';
  END IF;

  FOR pot_entry IN SELECT value FROM jsonb_array_elements(p_pot_entries)
  LOOP
    BEGIN
      pot_id := (pot_entry ->> 'pot_type_id')::uuid;
      pot_quantity := (pot_entry ->> 'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Type ou quantité de pot invalide.' USING ERRCODE = '22023';
    END;

    IF pot_quantity <= 0 THEN
      RAISE EXCEPTION 'La quantité de pots doit être positive.' USING ERRCODE = '22023';
    END IF;

    SELECT name INTO pot_name
    FROM public.pot_types
    WHERE id = pot_id AND is_active = true
    FOR UPDATE;
    IF pot_name IS NULL THEN
      RAISE EXCEPTION 'Type de pot actif introuvable.' USING ERRCODE = '22023';
    END IF;

    total_quantity := total_quantity + pot_quantity;
    first_pot_type := coalesce(first_pot_type, pot_id);
  END LOOP;

  INSERT INTO public.delivery_batches (
    batch_code, driver_id, pot_type_id, quantity, zone, batch_type, status, created_by
  ) VALUES (
    p_batch_code,
    p_driver_id,
    CASE WHEN needs_pots THEN first_pot_type ELSE NULL END,
    CASE WHEN needs_pots THEN total_quantity ELSE NULL END,
    coalesce(p_zone, ''),
    p_batch_type,
    'actif',
    actor_id
  ) RETURNING * INTO created_batch;

  INSERT INTO public.batch_sales_points (batch_id, sales_point_id)
  SELECT created_batch.id, sales_point_id
  FROM unnest(coalesce(p_sales_point_ids, '{}'::uuid[])) AS sales_point_id;

  IF needs_pots THEN
    INSERT INTO public.batch_pot_types (
      batch_id, pot_type_id, quantity, empty_pots, empty_lids
    )
    SELECT
      created_batch.id,
      (entry ->> 'pot_type_id')::uuid,
      (entry ->> 'quantity')::integer,
      greatest(coalesce((entry ->> 'empty_pots')::integer, 0), 0),
      greatest(coalesce((entry ->> 'empty_lids')::integer, 0), 0)
    FROM jsonb_array_elements(p_pot_entries) AS entry;

    FOR pot_entry IN SELECT value FROM jsonb_array_elements(p_pot_entries)
    LOOP
      pot_id := (pot_entry ->> 'pot_type_id')::uuid;
      pot_quantity := (pot_entry ->> 'quantity')::integer;

      UPDATE public.pot_types
      SET stock_quantity = stock_quantity - pot_quantity
      WHERE id = pot_id AND stock_quantity >= pot_quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuffisant pour le type de pot sélectionné.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.stock_movements (
        pot_type_id, movement_type, quantity, batch_id, driver_id,
        reference_id, notes, created_by
      ) VALUES (
        pot_id, 'attribution', pot_quantity, created_batch.id, p_driver_id,
        created_batch.id, 'Attribution lot ' || p_batch_code, actor_id
      );
    END LOOP;
  END IF;

  SELECT string_agg(
    pt.name || '×' || (entry ->> 'quantity') ||
      CASE WHEN coalesce((entry ->> 'empty_pots')::integer, 0) > 0
        THEN ' + ' || (entry ->> 'empty_pots') || ' vides' ELSE '' END ||
      CASE WHEN coalesce((entry ->> 'empty_lids')::integer, 0) > 0
        THEN ' + ' || (entry ->> 'empty_lids') || ' couvercles' ELSE '' END,
    ', '
  ) INTO pot_summary
  FROM jsonb_array_elements(p_pot_entries) AS entry
  JOIN public.pot_types pt ON pt.id = (entry ->> 'pot_type_id')::uuid;

  INSERT INTO public.delivery_events (
    event_type, batch_id, driver_id, description, performed_by
  ) VALUES (
    'lot_cree', created_batch.id, p_driver_id,
    'Tournée ' || p_batch_code || ' créée (' || p_batch_type || ') — ' ||
      coalesce(array_length(p_sales_point_ids, 1), 0) || ' PDV · ' ||
      coalesce(pot_summary, 'aucun pot'),
    actor_id
  );

  INSERT INTO public.delivery_batch_approvals (batch_id, requested_by)
  VALUES (created_batch.id, actor_id);

  INSERT INTO public.app_notifications (
    user_id, title, message, type, priority, link_page
  )
  SELECT
    profile.id,
    'Validation de lot requise',
    'Le lot ' || p_batch_code || ' a été créé et est déjà opérationnel. Validation à effectuer.',
    'warning',
    'moyenne',
    'batches'
  FROM public.profiles AS profile
  WHERE profile.role IN (4, 5, 6) AND profile.is_active = true;

  RETURN to_jsonb(created_batch);
END;
$$;

REVOKE ALL ON FUNCTION public.create_delivery_batch_bundle(text, uuid, text, text, uuid[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_delivery_batch_bundle(text, uuid, text, text, uuid[], jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_batch_bundle(text, uuid, text, text, uuid[], jsonb) TO authenticated;
