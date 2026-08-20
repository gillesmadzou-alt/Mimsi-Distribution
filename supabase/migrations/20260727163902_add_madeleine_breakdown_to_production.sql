-- Link bakers to user accounts so each fournier can record production personally
ALTER TABLE bakers ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bakers_profile ON bakers(profile_id) WHERE profile_id IS NOT NULL;

-- Track madeleines produced in 3 categories: good (vendable), burned (cramées), defective (mauvais état)
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS madeleines_good integer NOT NULL DEFAULT 0 CHECK (madeleines_good >= 0);
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS madeleines_burned integer NOT NULL DEFAULT 0 CHECK (madeleines_burned >= 0);
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS madeleines_defective integer NOT NULL DEFAULT 0 CHECK (madeleines_defective >= 0);
