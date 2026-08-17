/*
# Add pâte (dough batch) tracking and madeleine compliance to production records

## Purpose
Track how many individual pâtes (dough batches of 7.5 kg each) were used in a
production, and automatically compare the expected madeleine output (471 per
pâte) against the actual madeleines produced. When the variance exceeds a
tolerance threshold, a compliance discrepancy is created and the DGA (role 4)
and Directrice (role 5) are notified.

## Norm / Reference
- 1 pâte = 7.5 kg de pâte
- 1 pâte = 471 madeleines (norme de production)
- Expected madeleines = pates_count × 471
- Actual madeleines = madeleines_good + madeleines_burned + madeleines_defective
- Variance = actual - expected
- Tolerance: ±5% (acceptable range: 95%–105% of expected)

## New columns on `production_records`
1. `pates_count` (integer, nullable) — Number of individual pâtes (7.5 kg each)
   used for this production.
2. `expected_madeleines` (integer, nullable) — Expected madeleine count based on
   pates_count × 471. Auto-calculated by the frontend.
3. `madeleine_variance` (numeric(8,2), nullable) — Percentage variance between
   actual and expected madeleines. Positive = overproduction, negative = underproduction.

## Security
- No new tables created.
- Existing RLS policies on `production_records` remain unchanged.
- No policy changes needed — the new columns are covered by existing INSERT/UPDATE policies.

## Notes
1. All three columns are nullable so existing production records remain valid.
2. The frontend auto-calculates `expected_madeleines` from `pates_count * 471`
   and `madeleine_variance` from `(actual - expected) / expected * 100`.
3. When |variance| > 5%, the frontend creates a `compliance_discrepancy` with
   `chain_stage = 'pate_production'` and sends `app_notifications` to roles 4 and 5.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='pates_count') THEN
    ALTER TABLE production_records ADD COLUMN pates_count integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='expected_madeleines') THEN
    ALTER TABLE production_records ADD COLUMN expected_madeleines integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='madeleine_variance') THEN
    ALTER TABLE production_records ADD COLUMN madeleine_variance numeric(8,2);
  END IF;
END $$;
