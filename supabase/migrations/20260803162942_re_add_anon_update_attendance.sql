/*
# Re-add anon UPDATE on attendance_records for departure

## Purpose
The kiosk departure flow needs to update an existing attendance record
(set departure_time and departure_photo_url). The anon UPDATE policy was
removed in a previous migration; it needs to be re-added so the kiosk
(without login) can record departures.
*/

DROP POLICY IF EXISTS "anon_update_attendance" ON attendance_records;
CREATE POLICY "anon_update_attendance"
ON attendance_records FOR UPDATE
TO anon USING (true) WITH CHECK (true);
