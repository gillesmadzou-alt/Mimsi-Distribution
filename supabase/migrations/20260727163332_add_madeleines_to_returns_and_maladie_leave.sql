-- Add madeleine_count to returns (retours/invendus can include madeleines counted separately from pots)
ALTER TABLE returns ADD COLUMN IF NOT EXISTS madeleine_count integer NOT NULL DEFAULT 0 CHECK (madeleine_count >= 0);

-- Add 'maladie' to leave_periods status check
ALTER TABLE leave_periods DROP CONSTRAINT IF EXISTS leave_periods_status_check;
ALTER TABLE leave_periods ADD CONSTRAINT leave_periods_status_check
  CHECK (status IN ('present', 'absent', 'conge_annuel', 'permission', 'day_off', 'maladie'));
