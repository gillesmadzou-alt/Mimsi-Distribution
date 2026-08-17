-- Link dough_deliveries to dough_batches (fabrication de pâte)
ALTER TABLE dough_deliveries
  ADD COLUMN IF NOT EXISTS dough_batch_id uuid REFERENCES dough_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dough_deliveries_batch ON dough_deliveries(dough_batch_id);
