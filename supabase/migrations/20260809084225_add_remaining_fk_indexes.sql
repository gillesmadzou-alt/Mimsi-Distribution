-- =============================================================
-- Migration: Add remaining missing FK indexes (batch 2)
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_fk_barcodes_pot_type_id ON barcodes (pot_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_compliance_audit_trail_decided_by ON compliance_audit_trail (decided_by);
CREATE INDEX IF NOT EXISTS idx_fk_compliance_comments_discrepancy_id ON compliance_comments (discrepancy_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_expenses_deposit_id ON delivery_expenses (deposit_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_expenses_driver_id ON delivery_expenses (driver_id);
CREATE INDEX IF NOT EXISTS idx_fk_deposits_barcode_id ON deposits (barcode_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_batch_ingredients_dough_batch_id ON dough_batch_ingredients (dough_batch_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_batch_ingredients_ingredient_id ON dough_batch_ingredients (ingredient_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_batches_kneader_id ON dough_batches (kneader_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_deliveries_baker_id ON dough_deliveries (baker_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_deliveries_dough_batch_id ON dough_deliveries (dough_batch_id);
CREATE INDEX IF NOT EXISTS idx_fk_dough_deliveries_kneader_id ON dough_deliveries (kneader_id);
CREATE INDEX IF NOT EXISTS idx_fk_drivers_user_id ON drivers (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_field_observation_comments_observation_id ON field_observation_comments (observation_id);
CREATE INDEX IF NOT EXISTS idx_fk_ingredients_supplier_id ON ingredients (supplier_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_periods_profile_id ON leave_periods (profile_id);
CREATE INDEX IF NOT EXISTS idx_fk_opportunistic_sales_driver_id ON opportunistic_sales (driver_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_records_baker_id ON production_records (baker_id);
CREATE INDEX IF NOT EXISTS idx_fk_receivable_payments_batch_id ON receivable_payments (batch_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_movements_baker_id ON stock_movements (baker_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_movements_driver_id ON stock_movements (driver_id);
CREATE INDEX IF NOT EXISTS idx_fk_wedding_orders_driver_id ON wedding_orders (driver_id);
