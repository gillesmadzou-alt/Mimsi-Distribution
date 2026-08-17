-- =============================================================
-- Migration: Drop unused indexes
-- These indexes consume disk space and slow down writes
-- without serving any queries. Identified by Supabase advisor.
-- =============================================================

DROP INDEX IF EXISTS public.idx_cc_discrepancy;
DROP INDEX IF EXISTS public.idx_cc_created;
DROP INDEX IF EXISTS public.idx_drivers_user_id;
DROP INDEX IF EXISTS public.idx_drivers_zone;
DROP INDEX IF EXISTS public.idx_sales_points_district;
DROP INDEX IF EXISTS public.idx_stock_handovers_type;
DROP INDEX IF EXISTS public.idx_restock_status;
DROP INDEX IF EXISTS public.idx_production_baker;
DROP INDEX IF EXISTS public.idx_driver_locations_tracking;
DROP INDEX IF EXISTS public.idx_leave_profile;
DROP INDEX IF EXISTS public.idx_dough_kneader;
DROP INDEX IF EXISTS public.idx_dough_baker;
DROP INDEX IF EXISTS public.idx_audit_trail_entity;
DROP INDEX IF EXISTS public.idx_audit_trail_decided_by;
DROP INDEX IF EXISTS public.idx_sales_points_zone;
DROP INDEX IF EXISTS public.idx_sales_points_quota_status;
DROP INDEX IF EXISTS public.idx_sales_points_is_new;
DROP INDEX IF EXISTS public.idx_quota_payments_date;
DROP INDEX IF EXISTS public.idx_barcodes_is_used;
DROP INDEX IF EXISTS public.idx_barcodes_pot_type_id;
DROP INDEX IF EXISTS public.idx_deposits_barcode_id;
DROP INDEX IF EXISTS public.idx_receivable_payments_batch_id;
DROP INDEX IF EXISTS public.idx_app_notifications_priority;
DROP INDEX IF EXISTS public.idx_stock_movements_driver;
DROP INDEX IF EXISTS public.idx_stock_movements_baker;
DROP INDEX IF EXISTS public.idx_dough_deliveries_batch;
DROP INDEX IF EXISTS public.idx_work_schedules_person;
DROP INDEX IF EXISTS public.idx_ingredients_category;
DROP INDEX IF EXISTS public.idx_dough_batches_kneader;
DROP INDEX IF EXISTS public.idx_dough_batch_ingredients_batch;
DROP INDEX IF EXISTS public.idx_dough_batch_ingredients_ingredient;
DROP INDEX IF EXISTS public.idx_delivery_expenses_type;
DROP INDEX IF EXISTS public.idx_field_observations_category;
DROP INDEX IF EXISTS public.idx_field_observations_status;
DROP INDEX IF EXISTS public.idx_delivery_expenses_driver;
DROP INDEX IF EXISTS public.idx_field_obs_comments_obs_id;
DROP INDEX IF EXISTS public.idx_delivery_expenses_deposit;
DROP INDEX IF EXISTS public.idx_delivery_expenses_created_at;
DROP INDEX IF EXISTS public.idx_ingredients_supplier_id;
DROP INDEX IF EXISTS public.idx_attendance_person;
DROP INDEX IF EXISTS public.idx_opportunistic_sales_driver;
DROP INDEX IF EXISTS public.idx_wedding_orders_driver;
DROP INDEX IF EXISTS public.idx_wedding_orders_status;
