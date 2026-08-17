/*
# Barcodes table for single-use pot labels

1. Purpose
   Each barcode generated for pot labeling is single-use: it is created,
   printed as a PDF label, and then consumed exactly once when a deposit
   references it. This table persists generated barcodes so the app can
   track which codes have been used and which are still available.

2. New Table: `barcodes`
   - `id` (uuid, primary key)
   - `code` (text, unique, not null) — the human-readable + scannable code
   - `pot_type_id` (uuid, FK to pot_types, not null) — which pot type this label is for
   - `quantity` (integer, default 1) — number of pots this label covers
   - `notes` (text, nullable) — optional batch/lot note
   - `is_used` (boolean, default false) — whether this barcode has been consumed
   - `used_at` (timestamptz, nullable) — when it was consumed
   - `created_by` (uuid, FK to profiles, default auth.uid())
   - `created_at` (timestamptz, default now())

3. Security (RLS)
   - SELECT: all authenticated users can see barcodes
   - INSERT: role >= 2 (supervisors and above generate barcodes)
   - UPDATE: role >= 3 (comptable+ can mark a barcode as used)
   - DELETE: role >= 4 (directeur+ can delete barcodes)

4. Notes
   - The `code` column does NOT embed today's date; codes use a random
     component plus a sequence number so the production date is not
     readable from the label.
   - No FK to deposits yet; a future migration can add `deposit_id` if
     we want to link a consumed barcode to a specific deposit.
*/

CREATE TABLE IF NOT EXISTS barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  notes text,
  is_used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_barcodes" ON barcodes;
CREATE POLICY "select_barcodes" ON barcodes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_barcodes" ON barcodes;
CREATE POLICY "insert_barcodes" ON barcodes FOR INSERT
  TO authenticated WITH CHECK (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "update_barcodes" ON barcodes;
CREATE POLICY "update_barcodes" ON barcodes FOR UPDATE
  TO authenticated USING (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 3
  ) WITH CHECK (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 3
  );

DROP POLICY IF EXISTS "delete_barcodes" ON barcodes;
CREATE POLICY "delete_barcodes" ON barcodes FOR DELETE
  TO authenticated USING (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 4
  );

CREATE INDEX IF NOT EXISTS idx_barcodes_is_used ON barcodes(is_used);
CREATE INDEX IF NOT EXISTS idx_barcodes_pot_type_id ON barcodes(pot_type_id);
