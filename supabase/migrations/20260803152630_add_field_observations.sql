/*
# Add field observations (notes/remarks by staff)

## Purpose
Allows every staff member (drivers, bakers, kneaders, stock managers, directors, etc.)
to record observations or remarks they make during their daily tasks: deliveries,
dough preparation, baking, stock management, or any other role-related activity.

## New Tables

### 1. `field_observations`
Stores a single observation note.
- `id` (uuid PK)
- `author_id` (uuid, NOT NULL, DEFAULT auth.uid()) — the user who wrote the observation
- `author_name` (text) — denormalized display name at time of writing
- `author_role` (int) — denormalized role at time of writing
- `category` (text NOT NULL) — what activity the observation relates to:
    'livraison' | 'fabrication_pate' | 'cuisson' | 'stock' | 'autre'
- `priority` (text NOT NULL DEFAULT 'normale') — 'info' | 'normale' | 'importante'
- `title` (text NOT NULL) — short summary
- `body` (text NOT NULL) — detailed remark
- `related_batch_id` (uuid NULL) — optional link to a delivery batch
- `related_sales_point_id` (uuid NULL) — optional link to a sales point
- `related_production_id` (uuid NULL) — optional link to a production record
- `status` (text NOT NULL DEFAULT 'ouvert') — 'ouvert' | 'en_cours' | 'resolu' | 'ferme'
- `created_at` (timestamptz DEFAULT now())
- `updated_at` (timestamptz DEFAULT now())

### 2. `field_observation_comments`
Stores follow-up comments on an observation (discussion thread).
- `id` (uuid PK)
- `observation_id` (uuid, FK → field_observations, ON DELETE CASCADE)
- `author_id` (uuid, NOT NULL, DEFAULT auth.uid())
- `author_name` (text) — denormalized display name
- `author_role` (int) — denormalized role
- `comment` (text NOT NULL)
- `created_at` (timestamptz DEFAULT now())

## Security (RLS)
Both tables are accessible to all authenticated users (read + write).
Any signed-in staff member can create observations and comment on any observation.
This is intentional: observations are shared across the organisation so that
everyone — staff and management — can see and discuss what was noticed.

## Indexes
- `idx_field_observations_created_at` on `field_observations(created_at DESC)`
- `idx_field_observations_category` on `field_observations(category)`
- `idx_field_observations_status` on `field_observations(status)`
- `idx_field_obs_comments_obs_id` on `field_observation_comments(observation_id)`
*/

-- ── field_observations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_observations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL DEFAULT auth.uid(),
  author_name   text NOT NULL,
  author_role   int  NOT NULL,
  category      text NOT NULL CHECK (category IN ('livraison','fabrication_pate','cuisson','stock','autre')),
  priority      text NOT NULL DEFAULT 'normale' CHECK (priority IN ('info','normale','importante')),
  title         text NOT NULL,
  body          text NOT NULL,
  related_batch_id         uuid,
  related_sales_point_id   uuid,
  related_production_id     uuid,
  status        text NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','en_cours','resolu','ferme')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE field_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "obs_select_all" ON field_observations;
CREATE POLICY "obs_select_all"
  ON field_observations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "obs_insert_own" ON field_observations;
CREATE POLICY "obs_insert_own"
  ON field_observations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "obs_update_own" ON field_observations;
CREATE POLICY "obs_update_own"
  ON field_observations FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "obs_delete_own" ON field_observations;
CREATE POLICY "obs_delete_own"
  ON field_observations FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);

CREATE INDEX IF NOT EXISTS idx_field_observations_created_at ON field_observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_observations_category   ON field_observations (category);
CREATE INDEX IF NOT EXISTS idx_field_observations_status     ON field_observations (status);

-- ── field_observation_comments ──────────────────────────────
CREATE TABLE IF NOT EXISTS field_observation_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id  uuid NOT NULL REFERENCES field_observations(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL DEFAULT auth.uid(),
  author_name     text NOT NULL,
  author_role     int  NOT NULL,
  comment         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE field_observation_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "obs_comment_select_all" ON field_observation_comments;
CREATE POLICY "obs_comment_select_all"
  ON field_observation_comments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "obs_comment_insert_own" ON field_observation_comments;
CREATE POLICY "obs_comment_insert_own"
  ON field_observation_comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "obs_comment_delete_own" ON field_observation_comments;
CREATE POLICY "obs_comment_delete_own"
  ON field_observation_comments FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);

CREATE INDEX IF NOT EXISTS idx_field_obs_comments_obs_id ON field_observation_comments (observation_id);

-- ── updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_field_observations_touch ON field_observations;
CREATE TRIGGER trg_field_observations_touch
  BEFORE UPDATE ON field_observations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
