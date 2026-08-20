/*
# Create attendance (liste de présence) table

## Purpose
Track arrival and departure times for all personnel at the service.
Everyone records their attendance EXCEPT administrators (role 6), DGA (role 4),
and Directrice (role 5) who are exempt ("largesses").

## New Tables
- `attendance_records`
  - `id` (uuid PK)
  - `person_id` (uuid, references auth.users) — the person whose attendance is recorded
  - `person_name` (text) — denormalized name for display
  - `person_role` (int) — denormalized role for filtering/display
  - `person_type` (text) — 'profile' | 'driver' | 'baker' | 'kneader' — which personnel table
  - `attendance_date` (date) — the work day
  - `arrival_time` (timetz, nullable) — when the person arrived
  - `departure_time` (timetz, nullable) — when the person left
  - `status` (text) — 'present' | 'absent' | 'retard' | 'conge' | 'mission'
  - `notes` (text, nullable)
  - `recorded_by` (uuid, references auth.users) — who recorded the entry
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

## Security
- RLS enabled
- All authenticated users can SELECT (shared personnel data)
- All authenticated users can INSERT/UPDATE (any authorized person can record attendance)
- DELETE restricted to roles 4+ (DGA, Directrice, Admin)

## Notes
- Unique constraint on (person_id, attendance_date) to prevent duplicate entries per person per day
- Index on attendance_date for fast daily queries
- Index on person_id for per-person history
*/

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  person_name text NOT NULL,
  person_role int NOT NULL,
  person_type text NOT NULL DEFAULT 'profile',
  attendance_date date NOT NULL,
  arrival_time timetz,
  departure_time timetz,
  status text NOT NULL DEFAULT 'present',
  notes text,
  recorded_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint: one record per person per day
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_records_person_date_unique'
  ) THEN
    ALTER TABLE attendance_records
    ADD CONSTRAINT attendance_records_person_date_unique UNIQUE (person_id, attendance_date);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_person ON attendance_records (person_id);

-- Enable RLS
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can view attendance
DROP POLICY IF EXISTS "select_attendance" ON attendance_records;
CREATE POLICY "select_attendance"
ON attendance_records FOR SELECT
TO authenticated USING (true);

-- INSERT: all authenticated users can record attendance
DROP POLICY IF EXISTS "insert_attendance" ON attendance_records;
CREATE POLICY "insert_attendance"
ON attendance_records FOR INSERT
TO authenticated WITH CHECK (true);

-- UPDATE: all authenticated users can update attendance (e.g. record departure)
DROP POLICY IF EXISTS "update_attendance" ON attendance_records;
CREATE POLICY "update_attendance"
ON attendance_records FOR UPDATE
TO authenticated USING (true) WITH CHECK (true);

-- DELETE: only senior roles (DGA 4+, Directrice 5+, Admin 6+) can delete
DROP POLICY IF EXISTS "delete_attendance" ON attendance_records;
CREATE POLICY "delete_attendance"
ON attendance_records FOR DELETE
TO authenticated USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role >= 4
  )
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance_records;
CREATE TRIGGER trg_attendance_updated_at
BEFORE UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION update_attendance_updated_at();
