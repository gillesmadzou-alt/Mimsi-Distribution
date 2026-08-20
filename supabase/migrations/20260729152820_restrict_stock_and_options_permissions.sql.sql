/*
# Restrict stock movement and pot type option permissions

## Summary
Tightens Row Level Security so that:
1. Stock movements (entrees/sorties) can only be recorded by:
   - gestionnaire_stock (role=2)
   - directeur adjoint / DGA (role=4)
   - directrice / DG (role=5)
   - admin (role=6)
   The comptable (role=3) and livreur (role=1) can no longer insert stock movements.
2. Pot type "options" (create new types, edit existing types) can only be done by:
   - DGA (role=4)
   - DG (role=5)
   - admin (role=6)
   The gestionnaire_stock (role=2) and comptable (role=3) can no longer create or edit pot types.

## Tables modified
- `pot_types` — INSERT and UPDATE policies restricted to roles 4, 5, 6
- `stock_movements` — INSERT policy restricted to roles 2, 4, 5, 6

## Security changes
- `pot_types_insert`: WITH CHECK role IN (4,5,6)  (was role >= 2)
- `pot_types_update`: USING + WITH CHECK role IN (4,5,6)  (was role >= 2)
- `stock_movements_insert`: WITH CHECK role IN (2,4,5,6)  (was role >= 2)

## Notes
1. SELECT policies are unchanged — all authenticated staff can still view stock and pot types.
2. pot_types DELETE remains role >= 4 (DGA/DG/admin), consistent with option management.
3. stock_movements UPDATE/DELETE remain role >= 4 / >= 5, unchanged.
*/

-- ===========================
-- POT TYPES — restrict create/edit to DGA, DG, admin
-- ===========================
DROP POLICY IF EXISTS "pot_types_insert" ON pot_types;
CREATE POLICY "pot_types_insert" ON pot_types FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)));

DROP POLICY IF EXISTS "pot_types_update" ON pot_types;
CREATE POLICY "pot_types_update" ON pot_types FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)));

-- ===========================
-- STOCK MOVEMENTS — restrict recording to gestionnaire_stock, DGA, DG, admin
-- ===========================
DROP POLICY IF EXISTS "stock_movements_insert" ON stock_movements;
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (2, 4, 5, 6)));
