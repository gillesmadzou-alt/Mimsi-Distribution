/*
# Révoquer EXECUTE FROM PUBLIC sur les fonctions SECURITY DEFINER

Les fonctions SECURITY DEFINER ont encore GRANT EXECUTE TO PUBLIC.
Cela permet à anon et authenticated de les appeler directement via l'API REST.
Ces fonctions sont des triggers internes, pas des API publiques.
*/

REVOKE EXECUTE ON FUNCTION public.notify_responsible_profiles(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_dough_weight_compliance() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_pate_to_production() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_production_to_stock() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_stock_to_delivery() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_directors_on_comment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_discrepancy_decision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_financial_check_decision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_quota_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_receivable_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_sales_point_changes() FROM PUBLIC;
