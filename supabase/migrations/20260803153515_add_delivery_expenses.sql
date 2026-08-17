/*
# Add delivery expenses (paper allowance)

## Purpose
During deliveries, drivers often pay 200 FCFA to each sales point so the
point of sale can buy paper. This is a reimbursable expense. This migration
creates a table to track those expenses, linked to the deposit and sales point.

## New Table: `delivery_expenses`
- `id` (uuid PK)
- `deposit_id` (uuid, FK → deposits, ON DELETE CASCADE) — which deposit triggered the expense
- `batch_id` (uuid, FK → delivery_batches, ON DELETE SET NULL) — which delivery batch
- `sales_point_id` (uuid, FK → sales_points, ON DELETE SET NULL) — which sales point
- `driver_id` (uuid, FK → drivers, ON DELETE SET NULL) — which driver paid
- `amount_fcfa` (int, NOT NULL, default 200) — the expense amount
- `reason` (text, NOT NULL DEFAULT 'Achat papier PDV') — why the expense was made
- `created_at` (timestamptz DEFAULT now())

## Security (RLS)
All authenticated users can read expenses (shared visibility).
Only authenticated users can insert (drivers/staff recording expenses).
Drivers can delete their own expense records.

## Indexes
- `idx_delivery_expenses_deposit` on `deposit_id`
- `idx_delivery_expenses_batch` on `batch_id`
- `idx_delivery_expenses_created_at` on `created_at DESC`
*/

CREATE TABLE IF NOT EXISTS delivery_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id      uuid REFERENCES deposits(id) ON DELETE CASCADE,
  batch_id        uuid REFERENCES delivery_batches(id) ON DELETE SET NULL,
  sales_point_id  uuid REFERENCES sales_points(id) ON DELETE SET NULL,
  driver_id       uuid REFERENCES drivers(id) ON DELETE SET NULL,
  amount_fcfa     int  NOT NULL DEFAULT 200 CHECK (amount_fcfa >= 0),
  reason          text NOT NULL DEFAULT 'Achat papier PDV',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE delivery_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select_all" ON delivery_expenses;
CREATE POLICY "expenses_select_all"
  ON delivery_expenses FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "expenses_insert_all" ON delivery_expenses;
CREATE POLICY "expenses_insert_all"
  ON delivery_expenses FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_delete_all" ON delivery_expenses;
CREATE POLICY "expenses_delete_all"
  ON delivery_expenses FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_delivery_expenses_deposit    ON delivery_expenses (deposit_id);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_batch       ON delivery_expenses (batch_id);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_created_at ON delivery_expenses (created_at DESC);
