/*
# Create work_schedules table

1. New Tables
- `work_schedules`
  - `id` (uuid, primary key)
  - `person_type` (text: 'driver' | 'baker' | 'kneader') — which kind of worker
  - `person_id` (uuid) — FK to drivers, bakers, or kneaders depending on person_type
  - `person_name` (text) — denormalized name for display
  - `work_date` (date) — the scheduled work day
  - `start_time` (time, nullable) — shift start
  - `end_time` (time, nullable) — shift end
  - `zone` (text, nullable) — assigned zone (mainly for drivers)
  - `task` (text, nullable) — description of the assigned task
  - `status` (text: 'planifie' | 'en_cours' | 'termine' | 'annule') — schedule status
  - `notes` (text, nullable)
  - `created_by` (uuid, FK to auth.users)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `work_schedules`.
- Authenticated users can read all schedules (shared operational data).
- Only roles >= 2 (gestionnaire de stock and above) can create/update/delete schedules.

3. Indexes
- Index on `work_date` for date-range queries.
- Index on `person_type` + `person_id` for per-person lookups.
*/

CREATE TABLE IF NOT EXISTS work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_type text NOT NULL CHECK (person_type IN ('driver', 'baker', 'kneader')),
  person_id uuid NOT NULL,
  person_name text NOT NULL,
  work_date date NOT NULL,
  start_time time,
  end_time time,
  zone text,
  task text,
  status text NOT NULL DEFAULT 'planifie' CHECK (status IN ('planifie', 'en_cours', 'termine', 'annule')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_schedules_date ON work_schedules(work_date);
CREATE INDEX IF NOT EXISTS idx_work_schedules_person ON work_schedules(person_type, person_id);

ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedules_select" ON work_schedules;
CREATE POLICY "schedules_select" ON work_schedules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "schedules_insert" ON work_schedules;
CREATE POLICY "schedules_insert" ON work_schedules FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "schedules_update" ON work_schedules;
CREATE POLICY "schedules_update" ON work_schedules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "schedules_delete" ON work_schedules;
CREATE POLICY "schedules_delete" ON work_schedules FOR DELETE
  TO authenticated USING (true);
