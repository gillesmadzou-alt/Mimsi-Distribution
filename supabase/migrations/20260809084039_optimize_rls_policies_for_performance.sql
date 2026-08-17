-- =============================================================
-- Migration: Optimize RLS policies for performance
-- Replaces per-row EXISTS subqueries on profiles with cached
-- private.get_my_role() STABLE function calls.
-- Also fixes duplicate INSERT policy on app_notifications.
-- =============================================================

DROP POLICY IF EXISTS delete_attendance ON attendance_records;
CREATE POLICY delete_attendance ON attendance_records FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS bakers_delete ON bakers;
CREATE POLICY bakers_delete ON bakers FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS bakers_insert ON bakers;
CREATE POLICY bakers_insert ON bakers FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS bakers_select ON bakers;
CREATE POLICY bakers_select ON bakers FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS bakers_update ON bakers;
CREATE POLICY bakers_update ON bakers FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS delete_barcodes ON barcodes;
CREATE POLICY delete_barcodes ON barcodes FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_barcodes ON barcodes;
CREATE POLICY insert_barcodes ON barcodes FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS select_barcodes ON barcodes;
CREATE POLICY select_barcodes ON barcodes FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS update_barcodes ON barcodes;
CREATE POLICY update_barcodes ON barcodes FOR UPDATE TO authenticated USING (private.get_my_role() >= 3) WITH CHECK (private.get_my_role() >= 3);

DROP POLICY IF EXISTS delete_batch_pot_types ON batch_pot_types;
CREATE POLICY delete_batch_pot_types ON batch_pot_types FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_batch_pot_types ON batch_pot_types;
CREATE POLICY insert_batch_pot_types ON batch_pot_types FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS select_batch_pot_types ON batch_pot_types;
CREATE POLICY select_batch_pot_types ON batch_pot_types FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS update_batch_pot_types ON batch_pot_types;
CREATE POLICY update_batch_pot_types ON batch_pot_types FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS delete_batch_sales_points ON batch_sales_points;
CREATE POLICY delete_batch_sales_points ON batch_sales_points FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_batch_sales_points ON batch_sales_points;
CREATE POLICY insert_batch_sales_points ON batch_sales_points FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS select_batch_sales_points ON batch_sales_points;
CREATE POLICY select_batch_sales_points ON batch_sales_points FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS update_batch_sales_points ON batch_sales_points;
CREATE POLICY update_batch_sales_points ON batch_sales_points FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS audit_trail_select ON compliance_audit_trail;
CREATE POLICY audit_trail_select ON compliance_audit_trail FOR SELECT TO authenticated USING (private.get_my_role() = ANY (ARRAY[4, 5, 6]));

DROP POLICY IF EXISTS compliance_delete ON compliance_checks;
CREATE POLICY compliance_delete ON compliance_checks FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS compliance_insert ON compliance_checks;
CREATE POLICY compliance_insert ON compliance_checks FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 3);

DROP POLICY IF EXISTS compliance_select ON compliance_checks;
CREATE POLICY compliance_select ON compliance_checks FOR SELECT TO authenticated USING (private.get_my_role() >= 3);

DROP POLICY IF EXISTS compliance_update ON compliance_checks;
CREATE POLICY compliance_update ON compliance_checks FOR UPDATE TO authenticated USING (private.get_my_role() >= 3) WITH CHECK (private.get_my_role() >= 3);

DROP POLICY IF EXISTS cc_delete ON compliance_comments;
CREATE POLICY cc_delete ON compliance_comments FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS cc_insert ON compliance_comments;
CREATE POLICY cc_insert ON compliance_comments FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS cc_select ON compliance_comments;
CREATE POLICY cc_select ON compliance_comments FOR SELECT TO authenticated USING (private.get_my_role() >= 3);

DROP POLICY IF EXISTS cc_update ON compliance_comments;
CREATE POLICY cc_update ON compliance_comments FOR UPDATE TO authenticated USING (private.get_my_role() >= 5) WITH CHECK (private.get_my_role() >= 5);

DROP POLICY IF EXISTS discrepancy_delete ON compliance_discrepancies;
CREATE POLICY discrepancy_delete ON compliance_discrepancies FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS discrepancy_select ON compliance_discrepancies;
CREATE POLICY discrepancy_select ON compliance_discrepancies FOR SELECT TO authenticated USING (private.get_my_role() >= 3);

DROP POLICY IF EXISTS discrepancy_update ON compliance_discrepancies;
CREATE POLICY discrepancy_update ON compliance_discrepancies FOR UPDATE TO authenticated USING (private.get_my_role() = ANY (ARRAY[4, 5, 6])) WITH CHECK (private.get_my_role() = ANY (ARRAY[4, 5, 6]));

DROP POLICY IF EXISTS cons_ret_delete ON consignment_returns;
CREATE POLICY cons_ret_delete ON consignment_returns FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS cons_ret_select ON consignment_returns;
CREATE POLICY cons_ret_select ON consignment_returns FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS cons_ret_update ON consignment_returns;
CREATE POLICY cons_ret_update ON consignment_returns FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS consignments_delete ON consignments;
CREATE POLICY consignments_delete ON consignments FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS consignments_select ON consignments;
CREATE POLICY consignments_select ON consignments FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS consignments_update ON consignments;
CREATE POLICY consignments_update ON consignments FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS batches_delete ON delivery_batches;
CREATE POLICY batches_delete ON delivery_batches FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS batches_insert ON delivery_batches;
CREATE POLICY batches_insert ON delivery_batches FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS batches_select ON delivery_batches;
CREATE POLICY batches_select ON delivery_batches FOR SELECT TO authenticated USING ((private.get_my_role() >= 2) OR (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = delivery_batches.driver_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS batches_update ON delivery_batches;
CREATE POLICY batches_update ON delivery_batches FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS events_delete ON delivery_events;
CREATE POLICY events_delete ON delivery_events FOR DELETE TO authenticated USING (private.get_my_role() >= 6);

DROP POLICY IF EXISTS events_select ON delivery_events;
CREATE POLICY events_select ON delivery_events FOR SELECT TO authenticated USING ((private.get_my_role() >= 2) OR (driver_id IN ( SELECT d.id
   FROM drivers d
  WHERE (d.user_id = auth.uid()))));

DROP POLICY IF EXISTS events_update ON delivery_events;
CREATE POLICY events_update ON delivery_events FOR UPDATE TO authenticated USING (private.get_my_role() >= 5) WITH CHECK (private.get_my_role() >= 5);

DROP POLICY IF EXISTS expenses_delete_all ON delivery_expenses;
CREATE POLICY expenses_delete_all ON delivery_expenses FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS expenses_insert_all ON delivery_expenses;
CREATE POLICY expenses_insert_all ON delivery_expenses FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS deposits_delete ON deposits;
CREATE POLICY deposits_delete ON deposits FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS deposits_insert ON deposits;
CREATE POLICY deposits_insert ON deposits FOR INSERT TO authenticated WITH CHECK ((private.get_my_role() >= 2) OR (EXISTS ( SELECT 1
   FROM (delivery_batches db
     JOIN drivers d ON ((d.id = db.driver_id)))
  WHERE ((db.id = deposits.batch_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS deposits_select ON deposits;
CREATE POLICY deposits_select ON deposits FOR SELECT TO authenticated USING ((private.get_my_role() >= 2) OR (EXISTS ( SELECT 1
   FROM (delivery_batches db
     JOIN drivers d ON ((d.id = db.driver_id)))
  WHERE ((db.id = deposits.batch_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS deposits_update ON deposits;
CREATE POLICY deposits_update ON deposits FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batch_ingredients_delete ON dough_batch_ingredients;
CREATE POLICY dough_batch_ingredients_delete ON dough_batch_ingredients FOR DELETE TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batch_ingredients_insert ON dough_batch_ingredients;
CREATE POLICY dough_batch_ingredients_insert ON dough_batch_ingredients FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batch_ingredients_update ON dough_batch_ingredients;
CREATE POLICY dough_batch_ingredients_update ON dough_batch_ingredients FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batches_delete ON dough_batches;
CREATE POLICY dough_batches_delete ON dough_batches FOR DELETE TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batches_insert ON dough_batches;
CREATE POLICY dough_batches_insert ON dough_batches FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_batches_update ON dough_batches;
CREATE POLICY dough_batches_update ON dough_batches FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_delete ON dough_deliveries;
CREATE POLICY dough_delete ON dough_deliveries FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS dough_insert ON dough_deliveries;
CREATE POLICY dough_insert ON dough_deliveries FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_select ON dough_deliveries;
CREATE POLICY dough_select ON dough_deliveries FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS dough_update ON dough_deliveries;
CREATE POLICY dough_update ON dough_deliveries FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS driver_locations_delete ON driver_locations;
CREATE POLICY driver_locations_delete ON driver_locations FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS driver_locations_insert ON driver_locations;
CREATE POLICY driver_locations_insert ON driver_locations FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_locations.driver_id) AND (d.user_id = auth.uid())))) OR (private.get_my_role() >= 4));

DROP POLICY IF EXISTS driver_locations_select ON driver_locations;
CREATE POLICY driver_locations_select ON driver_locations FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS driver_locations_update ON driver_locations;
CREATE POLICY driver_locations_update ON driver_locations FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_locations.driver_id) AND (d.user_id = auth.uid())))) OR (private.get_my_role() >= 4)) WITH CHECK ((EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_locations.driver_id) AND (d.user_id = auth.uid())))) OR (private.get_my_role() >= 4));

DROP POLICY IF EXISTS drivers_delete ON drivers;
CREATE POLICY drivers_delete ON drivers FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS drivers_insert ON drivers;
CREATE POLICY drivers_insert ON drivers FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS drivers_select_manager ON drivers;
CREATE POLICY drivers_select_manager ON drivers FOR SELECT TO authenticated USING ((private.get_my_role() >= 2) OR (user_id = auth.uid()));

DROP POLICY IF EXISTS drivers_update ON drivers;
CREATE POLICY drivers_update ON drivers FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS ingredients_delete ON ingredients;
CREATE POLICY ingredients_delete ON ingredients FOR DELETE TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS ingredients_insert ON ingredients;
CREATE POLICY ingredients_insert ON ingredients FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS ingredients_update ON ingredients;
CREATE POLICY ingredients_update ON ingredients FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS kneader_delete ON kneaders;
CREATE POLICY kneader_delete ON kneaders FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS kneader_insert ON kneaders;
CREATE POLICY kneader_insert ON kneaders FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS kneader_select ON kneaders;
CREATE POLICY kneader_select ON kneaders FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS kneader_update ON kneaders;
CREATE POLICY kneader_update ON kneaders FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS leave_delete ON leave_periods;
CREATE POLICY leave_delete ON leave_periods FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS leave_insert ON leave_periods;
CREATE POLICY leave_insert ON leave_periods FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS leave_select ON leave_periods;
CREATE POLICY leave_select ON leave_periods FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS leave_update ON leave_periods;
CREATE POLICY leave_update ON leave_periods FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS change_requests_delete ON personnel_change_requests;
CREATE POLICY change_requests_delete ON personnel_change_requests FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS change_requests_select ON personnel_change_requests;
CREATE POLICY change_requests_select ON personnel_change_requests FOR SELECT TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS change_requests_update ON personnel_change_requests;
CREATE POLICY change_requests_update ON personnel_change_requests FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS pot_types_delete ON pot_types;
CREATE POLICY pot_types_delete ON pot_types FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS pot_types_insert ON pot_types;
CREATE POLICY pot_types_insert ON pot_types FOR INSERT TO authenticated WITH CHECK (private.get_my_role() = ANY (ARRAY[4, 5, 6]));

DROP POLICY IF EXISTS pot_types_select ON pot_types;
CREATE POLICY pot_types_select ON pot_types FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS pot_types_update ON pot_types;
CREATE POLICY pot_types_update ON pot_types FOR UPDATE TO authenticated USING (private.get_my_role() = ANY (ARRAY[4, 5, 6])) WITH CHECK (private.get_my_role() = ANY (ARRAY[4, 5, 6]));

DROP POLICY IF EXISTS prod_delete ON production_records;
CREATE POLICY prod_delete ON production_records FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS prod_insert ON production_records;
CREATE POLICY prod_insert ON production_records FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS prod_select ON production_records;
CREATE POLICY prod_select ON production_records FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS prod_update ON production_records;
CREATE POLICY prod_update ON production_records FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS delete_qr_codes ON qr_codes;
CREATE POLICY delete_qr_codes ON qr_codes FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_qr_codes ON qr_codes;
CREATE POLICY insert_qr_codes ON qr_codes FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS select_qr_codes ON qr_codes;
CREATE POLICY select_qr_codes ON qr_codes FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS update_qr_codes ON qr_codes;
CREATE POLICY update_qr_codes ON qr_codes FOR UPDATE TO authenticated USING (private.get_my_role() >= 3) WITH CHECK (private.get_my_role() >= 3);

DROP POLICY IF EXISTS quota_pay_delete ON quota_payments;
CREATE POLICY quota_pay_delete ON quota_payments FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS quota_pay_insert ON quota_payments;
CREATE POLICY quota_pay_insert ON quota_payments FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 1);

DROP POLICY IF EXISTS quota_pay_select ON quota_payments;
CREATE POLICY quota_pay_select ON quota_payments FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS quota_pay_update ON quota_payments;
CREATE POLICY quota_pay_update ON quota_payments FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_receivable_payments ON receivable_payments;
CREATE POLICY insert_receivable_payments ON receivable_payments FOR INSERT TO authenticated WITH CHECK ((private.get_my_role() >= 3) OR (EXISTS ( SELECT 1
   FROM (receivables r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE ((r.id = receivable_payments.receivable_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS recv_pay_delete ON receivable_payments;
CREATE POLICY recv_pay_delete ON receivable_payments FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS recv_pay_select ON receivable_payments;
CREATE POLICY recv_pay_select ON receivable_payments FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS recv_pay_update ON receivable_payments;
CREATE POLICY recv_pay_update ON receivable_payments FOR UPDATE TO authenticated USING (private.get_my_role() >= 3) WITH CHECK (private.get_my_role() >= 3);

DROP POLICY IF EXISTS recv_delete ON receivables;
CREATE POLICY recv_delete ON receivables FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS recv_select ON receivables;
CREATE POLICY recv_select ON receivables FOR SELECT TO authenticated USING ((private.get_my_role() >= 3) OR (driver_id IN ( SELECT d.id
   FROM drivers d
  WHERE (d.user_id = auth.uid()))));

DROP POLICY IF EXISTS recv_update ON receivables;
CREATE POLICY recv_update ON receivables FOR UPDATE TO authenticated USING ((private.get_my_role() >= 3) OR (driver_id IN ( SELECT d.id
   FROM drivers d
  WHERE (d.user_id = auth.uid())))) WITH CHECK ((private.get_my_role() >= 3) OR (driver_id IN ( SELECT d.id
   FROM drivers d
  WHERE (d.user_id = auth.uid()))));

DROP POLICY IF EXISTS restock_delete ON restock_requests;
CREATE POLICY restock_delete ON restock_requests FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS restock_select ON restock_requests;
CREATE POLICY restock_select ON restock_requests FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS restock_update ON restock_requests;
CREATE POLICY restock_update ON restock_requests FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS delete_return_pot_types ON return_pot_types;
CREATE POLICY delete_return_pot_types ON return_pot_types FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS insert_return_pot_types ON return_pot_types;
CREATE POLICY insert_return_pot_types ON return_pot_types FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS select_return_pot_types ON return_pot_types;
CREATE POLICY select_return_pot_types ON return_pot_types FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS update_return_pot_types ON return_pot_types;
CREATE POLICY update_return_pot_types ON return_pot_types FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS returns_delete ON returns;
CREATE POLICY returns_delete ON returns FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS returns_insert ON returns;
CREATE POLICY returns_insert ON returns FOR INSERT TO authenticated WITH CHECK ((private.get_my_role() >= 2) OR (EXISTS ( SELECT 1
   FROM (delivery_batches db
     JOIN drivers d ON ((d.id = db.driver_id)))
  WHERE ((db.id = returns.batch_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS returns_select ON returns;
CREATE POLICY returns_select ON returns FOR SELECT TO authenticated USING ((private.get_my_role() >= 2) OR (EXISTS ( SELECT 1
   FROM (delivery_batches db
     JOIN drivers d ON ((d.id = db.driver_id)))
  WHERE ((db.id = returns.batch_id) AND (d.user_id = auth.uid())))));

DROP POLICY IF EXISTS returns_update ON returns;
CREATE POLICY returns_update ON returns FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS sales_points_delete ON sales_points;
CREATE POLICY sales_points_delete ON sales_points FOR DELETE TO authenticated USING (private.get_my_role() = ANY (ARRAY[4, 5, 6, 7]));

DROP POLICY IF EXISTS sales_points_insert ON sales_points;
CREATE POLICY sales_points_insert ON sales_points FOR INSERT TO authenticated WITH CHECK (private.get_my_role() = ANY (ARRAY[4, 5, 6, 7]));

DROP POLICY IF EXISTS sales_points_select ON sales_points;
CREATE POLICY sales_points_select ON sales_points FOR SELECT TO authenticated USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS sales_points_update ON sales_points;
CREATE POLICY sales_points_update ON sales_points FOR UPDATE TO authenticated USING (private.get_my_role() = ANY (ARRAY[4, 5, 6, 7])) WITH CHECK (private.get_my_role() = ANY (ARRAY[4, 5, 6, 7]));

DROP POLICY IF EXISTS handovers_delete ON stock_handovers;
CREATE POLICY handovers_delete ON stock_handovers FOR DELETE TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS handovers_select ON stock_handovers;
CREATE POLICY handovers_select ON stock_handovers FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS handovers_update ON stock_handovers;
CREATE POLICY handovers_update ON stock_handovers FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS stock_movements_delete ON stock_movements;
CREATE POLICY stock_movements_delete ON stock_movements FOR DELETE TO authenticated USING (private.get_my_role() >= 5);

DROP POLICY IF EXISTS stock_movements_insert ON stock_movements;
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT TO authenticated WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6]));

DROP POLICY IF EXISTS stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS stock_movements_update ON stock_movements;
CREATE POLICY stock_movements_update ON stock_movements FOR UPDATE TO authenticated USING (private.get_my_role() >= 4) WITH CHECK (private.get_my_role() >= 4);

DROP POLICY IF EXISTS suppliers_delete ON suppliers;
CREATE POLICY suppliers_delete ON suppliers FOR DELETE TO authenticated USING (private.get_my_role() >= 4);

DROP POLICY IF EXISTS suppliers_insert ON suppliers;
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS suppliers_select ON suppliers;
CREATE POLICY suppliers_select ON suppliers FOR SELECT TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS suppliers_update ON suppliers;
CREATE POLICY suppliers_update ON suppliers FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS schedules_delete ON work_schedules;
CREATE POLICY schedules_delete ON work_schedules FOR DELETE TO authenticated USING (private.get_my_role() >= 2);

DROP POLICY IF EXISTS schedules_insert ON work_schedules;
CREATE POLICY schedules_insert ON work_schedules FOR INSERT TO authenticated WITH CHECK (private.get_my_role() >= 2);

DROP POLICY IF EXISTS schedules_update ON work_schedules;
CREATE POLICY schedules_update ON work_schedules FOR UPDATE TO authenticated USING (private.get_my_role() >= 2) WITH CHECK (private.get_my_role() >= 2);

-- Fix duplicate INSERT policy on app_notifications
DROP POLICY IF EXISTS notif_insert ON app_notifications;
DROP POLICY IF EXISTS notification_insert ON app_notifications;
CREATE POLICY notif_insert ON app_notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
