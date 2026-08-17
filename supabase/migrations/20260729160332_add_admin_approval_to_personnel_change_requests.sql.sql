-- Add administrator approval columns to personnel_change_requests
-- Allows the administrator (role 0) to approve personnel change requests
-- independently of the Directrice and Directeur adjoint

ALTER TABLE personnel_change_requests
  ADD COLUMN IF NOT EXISTS admin_approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz;

COMMENT ON COLUMN personnel_change_requests.admin_approved_by IS 'UUID of the administrator who approved this request';
COMMENT ON COLUMN personnel_change_requests.admin_approved_at IS 'Timestamp when the administrator approved this request';
