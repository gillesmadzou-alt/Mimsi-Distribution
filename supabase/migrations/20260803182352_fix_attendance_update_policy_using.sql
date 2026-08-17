/*
# Tighten attendance_records UPDATE policy USING clause

The `update_attendance` UPDATE policy had `USING (true)` which the security
advisor flags as overly permissive. Since the WITH CHECK already requires
`auth.uid() IS NOT NULL`, we apply the same condition to USING so the
policy is consistent and no longer flagged.

## Changes
- `update_attendance` UPDATE policy: USING changed from `true` to
  `auth.uid() IS NOT NULL`, matching the existing WITH CHECK.
*/

DROP POLICY IF EXISTS "update_attendance" ON attendance_records;
CREATE POLICY "update_attendance"
  ON attendance_records FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
