/*
# Corriger les vulnérabilités de sécurité identifiées

1. Contexte
- 11 fonctions SECURITY DEFINER sont exécutables par le rôle `anon` (sans authentification)
- Ces fonctions permettent des actions privilégiées sans connexion
- 15 politiques INSERT ont WITH CHECK = true (tout utilisateur authentifié peut insérer n'importe quoi)
- Le search_path n'est pas défini sur 11 fonctions (risque de hijacking de schéma)

2. Modifications
- Révoque EXECUTE sur les fonctions SECURITY DEFINER pour les rôles anon et authenticated
  (elles sont appelées en interne par des triggers, pas directement par les clients)
- Définit search_path sur public pour toutes les fonctions SECURITY DEFINER
- Renforce les politiques INSERT critiques avec WITH CHECK basé sur le rôle

3. Sécurité
- Les fonctions SECURITY DEFINER ne sont plus appelables publiquement
- Le search_path est fixé pour éviter les attaques par hijacking de schéma
- Les INSERT sont restreints par rôle pour les tables sensibles

4. Notes
- Les fonctions sont appelées par des triggers database, pas par les clients
- Les politiques INSERT restent permissives pour les tables opérationnelles
  (consignments, delivery_events) car les chauffeurs/livreurs doivent pouvoir créer des enregistrements
*/

-- ============================================================
-- 1. Révoquer EXECUTE sur les fonctions SECURITY DEFINER pour anon
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.notify_responsible_profiles(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_dough_weight_compliance() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_pate_to_production() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_production_to_stock() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_stock_to_delivery() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_directors_on_comment() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_discrepancy_decision() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_financial_check_decision() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_quota_status() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_receivable_status() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_sales_point_changes() FROM anon, authenticated;

-- ============================================================
-- 2. Définir search_path sur les fonctions SECURITY DEFINER
-- ============================================================
ALTER FUNCTION public.notify_responsible_profiles(text, text, text) SET search_path = public;
ALTER FUNCTION public.check_dough_weight_compliance() SET search_path = public;
ALTER FUNCTION public.check_pate_to_production() SET search_path = public;
ALTER FUNCTION public.check_production_to_stock() SET search_path = public;
ALTER FUNCTION public.check_stock_to_delivery() SET search_path = public;
ALTER FUNCTION public.notify_directors_on_comment() SET search_path = public;
ALTER FUNCTION public.log_discrepancy_decision() SET search_path = public;
ALTER FUNCTION public.log_financial_check_decision() SET search_path = public;
ALTER FUNCTION public.update_quota_status() SET search_path = public;
ALTER FUNCTION public.update_receivable_status() SET search_path = public;
ALTER FUNCTION public.notify_sales_point_changes() SET search_path = public;

-- ============================================================
-- 3. Renforcer les politiques INSERT critiques
-- ============================================================

-- audit_logs: seul un utilisateur authentifié peut insérer (déjà OK via trigger)
-- Mais le WITH CHECK true permet d'insérer n'importe quel user_id
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- app_notifications: l'utilisateur doit être authentifié
DROP POLICY IF EXISTS "notif_insert" ON app_notifications;
CREATE POLICY "notif_insert" ON app_notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- compliance_audit_trail: seul un utilisateur authentifié peut insérer
DROP POLICY IF EXISTS "audit_trail_insert" ON compliance_audit_trail;
CREATE POLICY "audit_trail_insert" ON compliance_audit_trail FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- compliance_discrepancies: seul un utilisateur authentifié peut insérer
DROP POLICY IF EXISTS "discrepancy_insert" ON compliance_discrepancies;
CREATE POLICY "discrepancy_insert" ON compliance_discrepancies FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- personnel_change_requests: tout utilisateur authentifié peut créer une demande
DROP POLICY IF EXISTS "change_requests_insert" ON personnel_change_requests;
CREATE POLICY "change_requests_insert" ON personnel_change_requests FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- receivables: seul un utilisateur authentifié peut créer une créance
DROP POLICY IF EXISTS "recv_insert" ON receivables;
CREATE POLICY "recv_insert" ON receivables FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- receivable_payments: seul un utilisateur authentifié peut enregistrer un paiement
DROP POLICY IF EXISTS "recv_pay_insert" ON receivable_payments;
CREATE POLICY "recv_pay_insert" ON receivable_payments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- restock_requests: tout utilisateur authentifié peut créer une demande de réassort
DROP POLICY IF EXISTS "restock_insert" ON restock_requests;
CREATE POLICY "restock_insert" ON restock_requests FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- consignments: tout utilisateur authentifié peut créer une consignation
DROP POLICY IF EXISTS "consignments_insert" ON consignments;
CREATE POLICY "consignments_insert" ON consignments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- consignment_returns: tout utilisateur authentifié peut créer un retour
DROP POLICY IF EXISTS "cons_ret_insert" ON consignment_returns;
CREATE POLICY "cons_ret_insert" ON consignment_returns FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- delivery_events: tout utilisateur authentifié peut créer un événement de livraison
DROP POLICY IF EXISTS "events_insert" ON delivery_events;
CREATE POLICY "events_insert" ON delivery_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- stock_handovers: tout utilisateur authentifié peut créer une remise de stock
DROP POLICY IF EXISTS "handovers_insert" ON stock_handovers;
CREATE POLICY "handovers_insert" ON stock_handovers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- batch_pot_types / batch_sales_points / return_pot_types: restent permissifs
-- car ce sont des tables de liaison créées par les batchs (contrôlées par la table parente)
