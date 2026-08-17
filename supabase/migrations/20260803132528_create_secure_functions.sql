/*
# Fonctions sécurisées pour les opérations sensibles

1. Contexte
- Les opérations sensibles (activation/désactivation d'utilisateurs, décrément de stock,
  approbations de personnel, encaissement de créances) sont actuellement faites
  directement depuis le navigateur avec la clé anon, protégées uniquement par
  des vérifications côté interface.
- Un utilisateur peut contourner l'interface et modifier des données sensibles.

2. Modifications
- Crée 4 fonctions SECURITY DEFINER pour les opérations sensibles:
  a) toggle_user_active(p_target_uuid) — active/désactive un utilisateur (admin seulement)
  b) decrement_stock(p_pot_type_id, p_quantity) — décrément atomique du stock
  c) approve_personnel_request(p_request_id) — approbation atomique multi-rôle
  d) collect_receivable_payment(p_receivable_id, p_amount) — encaissement avec validation du montant

3. Sécurité
- Chaque fonction vérifie les permissions via auth.uid() et profiles.role
- SECURITY DEFINER permet d'exécuter avec les privilèges du propriétaire (postgres)
- search_path fixé à public
- EXECUTE accordé uniquement à authenticated
*/

-- ============================================================
-- a) Activer/désactiver un utilisateur (admin seulement, rôle >= 6)
-- ============================================================
CREATE OR REPLACE FUNCTION public.toggle_user_active(p_target_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role int;
  v_target_active boolean;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 6 THEN
    RAISE EXCEPTION 'Permission refusée : administrateur uniquement';
  END IF;

  SELECT is_active INTO v_target_active FROM profiles WHERE id = p_target_uuid;
  IF v_target_active IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  UPDATE profiles SET is_active = NOT v_target_active, updated_at = now()
  WHERE id = p_target_uuid;

  RETURN NOT v_target_active;
END;
$$;

-- ============================================================
-- b) Décrément atomique du stock (rôle >= 2)
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_pot_type_id uuid,
  p_quantity int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_stock int;
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 2 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  UPDATE pot_types
  SET stock_quantity = stock_quantity - p_quantity
  WHERE id = p_pot_type_id AND stock_quantity >= p_quantity
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Stock insuffisant ou type de pot introuvable';
  END IF;

  RETURN v_new_stock;
END;
$$;

-- ============================================================
-- c) Approuver une demande de changement de personnel (atomique)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_personnel_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role int;
  v_req personnel_change_requests%ROWTYPE;
  v_all_approved boolean := false;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role < 4 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  SELECT * INTO v_req FROM personnel_change_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;
  IF v_req.status <> 'en_attente' THEN
    RAISE EXCEPTION 'Demande déjà traitée';
  END IF;

  -- Set this approver's column (idempotent: only if NULL)
  IF v_caller_role = 5 AND v_req.directrice_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET directrice_approved_by = v_caller_id, directrice_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  ELSIF v_caller_role = 4 AND v_req.adjoint_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET adjoint_approved_by = v_caller_id, adjoint_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  ELSIF v_caller_role = 0 AND v_req.admin_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET admin_approved_by = v_caller_id, admin_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  END IF;

  -- Re-read to check all three
  SELECT * INTO v_req FROM personnel_change_requests WHERE id = p_request_id;
  IF v_req.directrice_approved_by IS NOT NULL
     AND v_req.adjoint_approved_by IS NOT NULL
     AND v_req.admin_approved_by IS NOT NULL
     AND v_req.applied = false THEN
    UPDATE personnel_change_requests SET status = 'validee', updated_at = now() WHERE id = p_request_id;
    v_all_approved := true;
  END IF;

  RETURN v_all_approved;
END;
$$;

-- ============================================================
-- d) Encaisser un paiement de créance (validation du montant)
-- ============================================================
CREATE OR REPLACE FUNCTION public.collect_receivable_payment(
  p_receivable_id uuid,
  p_amount int,
  p_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recv RECORD;
  v_new_paid int;
  v_new_status text;
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 2 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  SELECT amount_fcfa, amount_paid INTO v_recv
  FROM receivables WHERE id = p_receivable_id FOR UPDATE;
  IF v_recv.amount_fcfa IS NULL THEN
    RAISE EXCEPTION 'Créance introuvable';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être positif';
  END IF;

  IF p_amount > (v_recv.amount_fcfa - v_recv.amount_paid) THEN
    RAISE EXCEPTION 'Le montant dépasse le reste à percevoir (%)', v_recv.amount_fcfa - v_recv.amount_paid;
  END IF;

  v_new_paid := v_recv.amount_paid + p_amount;
  v_new_status := CASE WHEN v_new_paid >= v_recv.amount_fcfa THEN 'solde' ELSE 'partiel' END;

  UPDATE receivables
  SET amount_paid = v_new_paid, status = v_new_status, updated_at = now()
  WHERE id = p_receivable_id;

  INSERT INTO receivable_payments (receivable_id, amount_fcfa, batch_id, notes)
  VALUES (p_receivable_id, p_amount, p_batch_id, 'Recouvrement tournée');

  RETURN jsonb_build_object(
    'amount_paid', v_new_paid,
    'status', v_new_status,
    'remaining', v_recv.amount_fcfa - v_new_paid
  );
END;
$$;

-- ============================================================
-- Accorder EXECUTE à authenticated uniquement
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.toggle_user_active(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_personnel_request(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.collect_receivable_payment(uuid, int, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.toggle_user_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_personnel_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_receivable_payment(uuid, int, uuid) TO authenticated;
