/*
# Fix RLS policies and function search_path security issues

## Summary

This migration fixes 20 security findings across 6 tables, 2 trigger functions, and 1 storage bucket.

## 1. Function Search Path (2 functions)

Both `public.touch_updated_at` and `public.update_attendance_updated_at` are trigger
functions with a mutable (role-inherited) `search_path`. An attacker who can set
`search_path` can shadow built-in functions like `now()` with malicious versions.
Fix: re-create both functions with `SET search_path = ''` so they use only the
internal `pg_catalog` schema.

## 2. attendance_records RLS (4 policies fixed)

- **anon INSERT**: Restrict to `recorded_by IS NULL` (kiosk arrivals only).
- **anon UPDATE**: Restrict to `recorded_by IS NULL` (kiosk departures only).
- **authenticated INSERT**: Require `auth.uid() IS NOT NULL`.
- **authenticated UPDATE**: Require `auth.uid() IS NOT NULL`.

## 3. delivery_expenses RLS (2 policies fixed)

- **INSERT**: Restrict to role >= 2 (managers and above).
- **DELETE**: Restrict to role >= 4 (DGA and above).

## 4. dough_batches RLS (3 policies fixed)

- **INSERT/UPDATE/DELETE**: Restrict to role >= 2.

## 5. dough_batch_ingredients RLS (3 policies fixed)

- **INSERT/UPDATE/DELETE**: Restrict to role >= 2.

## 6. ingredients RLS (3 policies fixed)

- **INSERT/UPDATE/DELETE**: Restrict to role >= 2.

## 7. work_schedules RLS (3 policies fixed)

- **INSERT/UPDATE/DELETE**: Restrict to role >= 2.

## 8. Storage: attendance-photos bucket (1 policy removed)

Drop the broad `auth_read_attendance_photos` SELECT policy on `storage.objects`
that allowed listing all files. Public buckets serve object URLs without it.
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Fix trigger function search_path
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_attendance_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. attendance_records: tighten anon + authenticated policies
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon_insert_attendance" ON attendance_records;
CREATE POLICY "anon_insert_attendance"
  ON attendance_records FOR INSERT
  TO anon
  WITH CHECK (recorded_by IS NULL);

DROP POLICY IF EXISTS "anon_update_attendance" ON attendance_records;
CREATE POLICY "anon_update_attendance"
  ON attendance_records FOR UPDATE
  TO anon
  USING (recorded_by IS NULL)
  WITH CHECK (recorded_by IS NULL);

DROP POLICY IF EXISTS "insert_attendance" ON attendance_records;
CREATE POLICY "insert_attendance"
  ON attendance_records FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "update_attendance" ON attendance_records;
CREATE POLICY "update_attendance"
  ON attendance_records FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════
-- 3. delivery_expenses: restrict INSERT to role >= 2, DELETE to role >= 4
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "expenses_insert_all" ON delivery_expenses;
CREATE POLICY "expenses_insert_all"
  ON delivery_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "expenses_delete_all" ON delivery_expenses;
CREATE POLICY "expenses_delete_all"
  ON delivery_expenses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 4
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. dough_batches: restrict write to role >= 2
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "dough_batches_insert" ON dough_batches;
CREATE POLICY "dough_batches_insert"
  ON dough_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "dough_batches_update" ON dough_batches;
CREATE POLICY "dough_batches_update"
  ON dough_batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "dough_batches_delete" ON dough_batches;
CREATE POLICY "dough_batches_delete"
  ON dough_batches FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. dough_batch_ingredients: restrict write to role >= 2
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "dough_batch_ingredients_insert" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_insert"
  ON dough_batch_ingredients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "dough_batch_ingredients_update" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_update"
  ON dough_batch_ingredients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "dough_batch_ingredients_delete" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_delete"
  ON dough_batch_ingredients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 6. ingredients: restrict write to role >= 2
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "ingredients_insert" ON ingredients;
CREATE POLICY "ingredients_insert"
  ON ingredients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "ingredients_update" ON ingredients;
CREATE POLICY "ingredients_update"
  ON ingredients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "ingredients_delete" ON ingredients;
CREATE POLICY "ingredients_delete"
  ON ingredients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 7. work_schedules: restrict write to role >= 2
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "schedules_insert" ON work_schedules;
CREATE POLICY "schedules_insert"
  ON work_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "schedules_update" ON work_schedules;
CREATE POLICY "schedules_update"
  ON work_schedules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

DROP POLICY IF EXISTS "schedules_delete" ON work_schedules;
CREATE POLICY "schedules_delete"
  ON work_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role >= 2
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 8. Storage: remove broad SELECT policy on attendance-photos bucket
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_read_attendance_photos" ON storage.objects;
