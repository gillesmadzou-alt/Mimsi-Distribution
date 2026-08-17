/*
# Add opportunistic sales and wedding orders

## Purpose
Drivers sometimes make opportunistic sales (ventes opportunes) outside the normal
delivery-batch / deposit flow, and also take wedding orders (commandes de pots de
madeleines pour mariages). These two new tables capture those transactions so they
appear in analytics alongside regular deposits.

## New Tables

### opportunistic_sales
- `id` (uuid PK)
- `driver_id` (uuid FK → drivers.id, NOT NULL) — which driver made the sale
- `pot_type_id` (uuid FK → pot_types.id, NULLABLE) — which pot type was sold (nullable for ad-hoc items)
- `item_description` (text) — free-text description of what was sold
- `quantity` (int, NOT NULL, default 1) — number of pots/items sold
- `unit_price_fcfa` (int, NOT NULL, default 0) — price per unit
- `total_amount_fcfa` (int, NOT NULL, default 0) — total sale amount
- `payment_type` (text, NOT NULL, default 'comptant') — 'comptant' | 'credit'
- `customer_name` (text, NULLABLE) — name of the buyer
- `customer_phone` (text, NULLABLE) — contact phone
- `sale_date` (date, NOT NULL, default CURRENT_DATE) — when the sale happened
- `notes` (text, NULLABLE)
- `created_by` (uuid, default auth.uid()) — who recorded it
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

### wedding_orders
- `id` (uuid PK)
- `driver_id` (uuid FK → drivers.id, NOT NULL) — which driver took the order
- `pot_type_id` (uuid FK → pot_types.id, NULLABLE) — which pot type was ordered
- `quantity` (int, NOT NULL, default 1) — number of pots ordered
- `unit_price_fcfa` (int, NOT NULL, default 0) — price per pot
- `total_amount_fcfa` (int, NOT NULL, default 0) — total order amount
- `bride_name` (text, NULLABLE) — name of the bride
- `groom_name` (text, NULLABLE) — name of the groom
- `customer_phone` (text, NULLABLE) — contact phone
- `wedding_date` (date, NULLABLE) — date of the wedding
- `delivery_address` (text, NULLABLE) — where to deliver
- `status` (text, NOT NULL, default 'en_attente') — 'en_attente' | 'confirme' | 'livre' | 'annule'
- `payment_status` (text, NOT NULL, default 'non_paye') — 'non_paye' | 'partiel' | 'paye'
- `amount_paid_fcfa` (int, NOT NULL, default 0) — how much has been paid so far
- `order_date` (date, NOT NULL, default CURRENT_DATE) — when the order was placed
- `notes` (text, NULLABLE)
- `created_by` (uuid, default auth.uid())
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

## Security
- RLS enabled on both tables.
- 4 policies per table (SELECT/INSERT/UPDATE/DELETE) scoped TO authenticated.
- Ownership is checked via `created_by = auth.uid()` for INSERT/UPDATE/DELETE.
- SELECT is open to all authenticated users (shared operational data).

## Notes
1. `total_amount_fcfa` is stored explicitly rather than computed, so it can be
   overridden for negotiated prices.
2. Both tables reference `drivers` (NOT NULL) since only drivers make these sales.
3. `pot_type_id` is nullable to allow ad-hoc items that don't match a known pot type.
*/

-- ============================================================
-- opportunistic_sales
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunistic_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pot_type_id uuid REFERENCES pot_types(id) ON DELETE SET NULL,
  item_description text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_fcfa integer NOT NULL DEFAULT 0 CHECK (unit_price_fcfa >= 0),
  total_amount_fcfa integer NOT NULL DEFAULT 0 CHECK (total_amount_fcfa >= 0),
  payment_type text NOT NULL DEFAULT 'comptant' CHECK (payment_type IN ('comptant', 'credit')),
  customer_name text,
  customer_phone text,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE opportunistic_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_opportunistic_sales" ON opportunistic_sales;
CREATE POLICY "select_opportunistic_sales" ON opportunistic_sales FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_opportunistic_sales" ON opportunistic_sales;
CREATE POLICY "insert_opportunistic_sales" ON opportunistic_sales FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_opportunistic_sales" ON opportunistic_sales;
CREATE POLICY "update_opportunistic_sales" ON opportunistic_sales FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "delete_opportunistic_sales" ON opportunistic_sales;
CREATE POLICY "delete_opportunistic_sales" ON opportunistic_sales FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- ============================================================
-- wedding_orders
-- ============================================================
CREATE TABLE IF NOT EXISTS wedding_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pot_type_id uuid REFERENCES pot_types(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_fcfa integer NOT NULL DEFAULT 0 CHECK (unit_price_fcfa >= 0),
  total_amount_fcfa integer NOT NULL DEFAULT 0 CHECK (total_amount_fcfa >= 0),
  bride_name text,
  groom_name text,
  customer_phone text,
  wedding_date date,
  delivery_address text,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'confirme', 'livre', 'annule')),
  payment_status text NOT NULL DEFAULT 'non_paye' CHECK (payment_status IN ('non_paye', 'partiel', 'paye')),
  amount_paid_fcfa integer NOT NULL DEFAULT 0 CHECK (amount_paid_fcfa >= 0),
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE wedding_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_wedding_orders" ON wedding_orders;
CREATE POLICY "select_wedding_orders" ON wedding_orders FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_wedding_orders" ON wedding_orders;
CREATE POLICY "insert_wedding_orders" ON wedding_orders FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_wedding_orders" ON wedding_orders;
CREATE POLICY "update_wedding_orders" ON wedding_orders FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "delete_wedding_orders" ON wedding_orders;
CREATE POLICY "delete_wedding_orders" ON wedding_orders FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_opportunistic_sales_driver ON opportunistic_sales(driver_id);
CREATE INDEX IF NOT EXISTS idx_opportunistic_sales_date ON opportunistic_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_wedding_orders_driver ON wedding_orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_wedding_orders_date ON wedding_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_wedding_orders_status ON wedding_orders(status);
