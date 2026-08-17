-- Allow drivers (role 1) to insert quota payments (progressive collection)
DROP POLICY IF EXISTS "quota_pay_insert" ON quota_payments;
CREATE POLICY "quota_pay_insert" ON quota_payments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));
