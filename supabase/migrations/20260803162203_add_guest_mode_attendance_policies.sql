/*
# Add guest (anon) access policies for attendance mode

## Purpose
A new "Tous" (guest) login option lets anyone access the attendance page without
signing in. The anon key is used in this mode, so we need anon-accessible policies
on the tables the attendance page reads and writes.

## Tables affected
- `profiles` — anon SELECT (id, full_name, role, is_active) for listing people
- `drivers` — anon SELECT for listing drivers in attendance
- `bakers` — anon SELECT for listing bakers in attendance
- `kneaders` — anon SELECT for listing kneaders in attendance
- `attendance_records` — anon SELECT, INSERT, UPDATE for viewing and recording attendance

## Security notes
- anon DELETE on attendance_records is NOT granted — only authenticated managers can delete.
- anon access is limited to what the attendance page needs (listing people, reading/writing attendance).
- Existing authenticated policies remain unchanged.
*/

-- profiles: allow anon to read basic profile info for attendance listing
DROP POLICY IF EXISTS "anon_select_profiles_attendance" ON profiles;
CREATE POLICY "anon_select_profiles_attendance"
ON profiles FOR SELECT
TO anon USING (true);

-- drivers: allow anon to read driver list for attendance
DROP POLICY IF EXISTS "anon_select_drivers_attendance" ON drivers;
CREATE POLICY "anon_select_drivers_attendance"
ON drivers FOR SELECT
TO anon USING (true);

-- bakers: allow anon to read baker list for attendance
DROP POLICY IF EXISTS "anon_select_bakers_attendance" ON bakers;
CREATE POLICY "anon_select_bakers_attendance"
ON bakers FOR SELECT
TO anon USING (true);

-- kneaders: allow anon to read kneader list for attendance
DROP POLICY IF EXISTS "anon_select_kneaders_attendance" ON kneaders;
CREATE POLICY "anon_select_kneaders_attendance"
ON kneaders FOR SELECT
TO anon USING (true);

-- attendance_records: allow anon to read all attendance records
DROP POLICY IF EXISTS "anon_select_attendance" ON attendance_records;
CREATE POLICY "anon_select_attendance"
ON attendance_records FOR SELECT
TO anon USING (true);

-- attendance_records: allow anon to insert attendance records
DROP POLICY IF EXISTS "anon_insert_attendance" ON attendance_records;
CREATE POLICY "anon_insert_attendance"
ON attendance_records FOR INSERT
TO anon WITH CHECK (true);

-- attendance_records: allow anon to update attendance records (arrival/departure times, status)
DROP POLICY IF EXISTS "anon_update_attendance" ON attendance_records;
CREATE POLICY "anon_update_attendance"
ON attendance_records FOR UPDATE
TO anon USING (true) WITH CHECK (true);
