/*
# QR codes for daily pot tracking

1. Purpose
   Each day, a QR code is generated to label pots produced that day.
   When a driver deposits pots at a sales point, they must scan the QR code
   as a mandatory confirmation. This creates an auditable link between
   production, delivery, and deposit.

2. New Table: `qr_codes`
   - `id` (uuid, primary key)
   - `code` (text, unique) — short human-readable code, e.g. "QR-20260727-ABCD"
   - `qr_data` (text) — the payload encoded in the QR (the code itself)
   - `production_date` (date, not null) — the production day this QR labels
   - `pot_type_id` (uuid, nullable FK to pot_types) — optional: specific pot type
   - `quantity` (integer, default 0) — number of pots labelled
   - `notes` (text, nullable)
   - `created_by` (uuid, FK to profiles, default auth.uid())
   - `created_at` (timestamptz, default now())

3. New Column on `deposits`
   - `qr_code_id` (uuid, nullable FK to qr_codes) — links a deposit to the
     QR code that was scanned as confirmation.

4. RLS on `qr_codes`
   - SELECT: all authenticated users
   - INSERT: role >= 2 (supervisors and above generate QR codes)
   - UPDATE: role >= 3
   - DELETE: role >= 4
*/

CREATE TABLE IF NOT EXISTS qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  qr_data text NOT NULL,
  production_date date NOT NULL,
  pot_type_id uuid REFERENCES pot_types(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_qr_codes" ON qr_codes;
CREATE POLICY "select_qr_codes" ON qr_codes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_qr_codes" ON qr_codes;
CREATE POLICY "insert_qr_codes" ON qr_codes FOR INSERT
  TO authenticated WITH CHECK (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "update_qr_codes" ON qr_codes;
CREATE POLICY "update_qr_codes" ON qr_codes FOR UPDATE
  TO authenticated USING (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 3
  ) WITH CHECK (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 3
  );

DROP POLICY IF EXISTS "delete_qr_codes" ON qr_codes;
CREATE POLICY "delete_qr_codes" ON qr_codes FOR DELETE
  TO authenticated USING (
    (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) >= 4
  );

-- Add qr_code_id to deposits
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS qr_code_id uuid REFERENCES qr_codes(id) ON DELETE SET NULL;
