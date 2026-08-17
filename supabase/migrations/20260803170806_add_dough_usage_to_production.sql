/*
# Add dough usage tracking to production records

## Purpose
Track how much dough each baker (fournier) actually used during production,
including the number of dough buckets consumed and the number of cakes (gateaux)
baked. This closes the traceability loop between dough deliveries from kneaders
and actual production output.

## Constants
- A full dough bucket weighs 12.8 kg
- An empty bucket weighs 0.4 kg
- Net dough weight per bucket = 12.8 - 0.4 = 12.4 kg

## New columns on `production_records`
1. `dough_used_kg` (numeric, nullable) — Total weight of dough used by the baker for this production, in kg.
2. `buckets_used` (integer, nullable) — Number of dough buckets consumed.
3. `cakes_baked` (integer, nullable, default 0) — Number of cakes (gateaux) actually baked (enfourné).

## Security
- No new tables created.
- Existing RLS policies on `production_records` remain unchanged and still apply.
- No policy changes needed — the new columns are covered by existing INSERT/UPDATE policies.

## Notes
1. All three columns are nullable so existing production records remain valid.
2. The frontend will auto-calculate `dough_used_kg` from `buckets_used * 12.4` when the baker selects a dough delivery, but the value can also be manually overridden.
3. Alerts (app_notifications) will be sent to the Direction (roles 4 and 5) when a production record is submitted, flagging any anomalies (e.g., dough received but not used, or cakes baked significantly lower than expected).
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='dough_used_kg') THEN
    ALTER TABLE production_records ADD COLUMN dough_used_kg numeric(10,2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='buckets_used') THEN
    ALTER TABLE production_records ADD COLUMN buckets_used integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_records' AND column_name='cakes_baked') THEN
    ALTER TABLE production_records ADD COLUMN cakes_baked integer NOT NULL DEFAULT 0;
  END IF;
END $$;
