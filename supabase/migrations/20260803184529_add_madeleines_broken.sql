/*
# Add madeleines_broken to production_records

1. Modified Tables
- `production_records`: add `madeleines_broken` (integer, default 0)
  — counts madeleines that are broken ("cassés"), separate from burned ("cramées") and defective.

2. Security
- No policy changes.
*/

ALTER TABLE public.production_records
  ADD COLUMN IF NOT EXISTS madeleines_broken integer NOT NULL DEFAULT 0;
