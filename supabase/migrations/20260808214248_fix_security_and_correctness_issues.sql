/*
# Fix security and correctness issues

## 1. attendance_records RLS hardening
- Drop and recreate authenticated INSERT policy to require `recorded_by = auth.uid()`.
- Drop and recreate authenticated UPDATE policy to require ownership (`recorded_by = auth.uid()`) or role >= 4.
- This prevents any signed-in user from forging attendance records for other people or editing other users' records.

## 2. app_notifications INSERT policy hardening
- Drop and recreate INSERT policy to require `user_id = auth.uid()`.
- This prevents notification forgery (sending notifications to arbitrary users).

## 3. audit_logs INSERT policy hardening
- Drop and recreate INSERT policy to require `performed_by = auth.uid()`.
- This prevents audit log spoofing (attributing actions to other users).

## 4. Fix toggle_user_active function
- Grant UPDATE on the `is_active` column back to `authenticated` role so the
  SECURITY INVOKER function `toggle_user_active` can update it.
  The column-level REVOKE from an earlier migration was too broad — it blocked
  the function from working. We keep the REVOKE on `role` (users must not change
  their own role) but restore `is_active` access for the function.
*/

-- 1. attendance_records: harden authenticated INSERT
DROP POLICY IF EXISTS "insert_attendance" ON attendance_records;
CREATE POLICY "insert_attendance" ON attendance_records FOR INSERT
  TO authenticated WITH CHECK (recorded_by = auth.uid());

-- 2. attendance_records: harden authenticated UPDATE
DROP POLICY IF EXISTS "update_attendance" ON attendance_records;
CREATE POLICY "update_attendance" ON attendance_records FOR UPDATE
  TO authenticated
  USING (recorded_by = auth.uid() OR private.get_my_role() >= 4)
  WITH CHECK (recorded_by = auth.uid() OR private.get_my_role() >= 4);

-- 3. app_notifications: require user_id = auth.uid() on INSERT
DROP POLICY IF EXISTS "insert_notifications" ON app_notifications;
DROP POLICY IF EXISTS "notification_insert" ON app_notifications;
CREATE POLICY "notification_insert" ON app_notifications FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

-- 4. audit_logs: require performed_by = auth.uid() on INSERT
DROP POLICY IF EXISTS "insert_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (performed_by = auth.uid());

-- 5. Restore is_active column UPDATE to authenticated (needed by toggle_user_active INVOKER function)
-- Keep role column revoked
REVOKE UPDATE (role, is_active) ON profiles FROM authenticated;
GRANT UPDATE (is_active) ON profiles TO authenticated;
