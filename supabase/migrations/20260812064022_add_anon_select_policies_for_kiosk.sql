-- Allow the kiosk (anon/unauthenticated) to read the names of active staff
-- so they can select themselves from a dropdown at check-in.
-- Only exposes the columns needed for identification; no sensitive data.

-- profiles: anon can read active profiles (id, full_name, role, is_active)
CREATE POLICY "anon_select_active_profiles"
  ON profiles FOR SELECT
  TO anon
  USING (is_active = true);

-- drivers: anon can read active drivers
CREATE POLICY "anon_select_active_drivers"
  ON drivers FOR SELECT
  TO anon
  USING (status = 'actif');

-- bakers: anon can read active bakers
CREATE POLICY "anon_select_active_bakers"
  ON bakers FOR SELECT
  TO anon
  USING (status = 'actif');

-- kneaders: anon can read active kneaders
CREATE POLICY "anon_select_active_kneaders"
  ON kneaders FOR SELECT
  TO anon
  USING (status = 'actif');
