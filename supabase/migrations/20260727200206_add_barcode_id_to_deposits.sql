/*
# Link barcodes to deposits

1. Purpose
   When a driver deposits pots at a sales point, they scan the barcode
   on the pot label. This links the single-use barcode to the deposit
   and marks it as consumed.

2. Changes
   - Add `barcode_id` (uuid, nullable FK to barcodes) to `deposits`
   - When a deposit is created with a barcode_id, the app marks that
     barcode as used (is_used = true, used_at = now())

3. Security
   - No new RLS policies needed; deposits already have policies.
   - barcodes UPDATE policy (role >= 3) already allows marking as used.
*/

ALTER TABLE deposits ADD COLUMN IF NOT EXISTS barcode_id uuid REFERENCES barcodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deposits_barcode_id ON deposits(barcode_id);
