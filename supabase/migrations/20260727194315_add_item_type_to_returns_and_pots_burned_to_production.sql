/*
# Add item_type to returns and pots_burned to production records

## Purpose
Retours/invendus can concern pots OR madeleines OR both. We need to explicitly
mark which type each return is about, so statistics can distinguish them.
Fourniers can burn whole pots (not just madeleines), so production_records
needs a pots_burned column alongside the existing madeleines_burned.

## Changes

### returns table
- Add `item_type` text column, default 'pots', with CHECK constraint
  limiting values to 'pots', 'madeleines', 'both'.
  - 'pots' = return concerns whole pots only (quantity field)
  - 'madeleines' = return concerns madeleines only (madeleine_count field)
  - 'both' = return concerns both pots and madeleines

### production_records table
- Add `pots_burned` integer column, default 0, CHECK >= 0.
  Records the number of whole pots burned during baking, distinct from
  madeleines_burned which tracks individual madeleines burned.

## Security
No RLS policy changes — existing policies already cover the new columns.
*/

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'pots'
  CHECK (item_type IN ('pots', 'madeleines', 'both'));

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS pots_burned integer NOT NULL DEFAULT 0
  CHECK (pots_burned >= 0);
