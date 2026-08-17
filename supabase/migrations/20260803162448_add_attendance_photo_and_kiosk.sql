/*
# Add photo to attendance + self-check-in kiosk support

## Purpose
Replace the previous "Tous" guest mode (which showed the full attendance list)
with a self-check-in kiosk: a person enters their name, firstname, function,
takes a mandatory photo, and registers as present. Also restrict the attendance
management page to admin/DG/DGA only.

## Changes

### 1. attendance_records table
- Add `photo_url` (text, nullable) — stores the storage path of the check-in photo.

### 2. Storage bucket
- Create `attendance-photos` public bucket for storing check-in photos.

### 3. Storage policies
- anon: can UPLOAD (INSERT) files to attendance-photos (kiosk users are not logged in)
- authenticated: can READ (SELECT) files from attendance-photos (admins viewing photos)

### 4. RLS cleanup
- Remove the broad anon SELECT policies on profiles, drivers, bakers, kneaders
  that were added for the previous guest mode (no longer needed — the kiosk
  doesn't list personnel, it only writes attendance records).
- Keep anon INSERT/UPDATE/SELECT on attendance_records (kiosk needs these).
- Remove anon UPDATE on attendance_records (kiosk only inserts; updates are
  done by authenticated managers in the admin page).

### 5. RLS note
- anon DELETE on attendance_records was never granted and stays that way.
*/

-- 1. Add photo_url column
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS photo_url text;

-- 2. Create storage bucket for attendance photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-photos', 'attendance-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies
-- anon can upload to attendance-photos
DROP POLICY IF EXISTS "anon_upload_attendance_photos" ON storage.objects;
CREATE POLICY "anon_upload_attendance_photos"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'attendance-photos');

-- authenticated can read attendance photos
DROP POLICY IF EXISTS "auth_read_attendance_photos" ON storage.objects;
CREATE POLICY "auth_read_attendance_photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'attendance-photos');

-- 4. RLS cleanup: remove broad anon SELECT on personnel tables
DROP POLICY IF EXISTS "anon_select_profiles_attendance" ON profiles;
DROP POLICY IF EXISTS "anon_select_drivers_attendance" ON drivers;
DROP POLICY IF EXISTS "anon_select_bakers_attendance" ON bakers;
DROP POLICY IF EXISTS "anon_select_kneaders_attendance" ON kneaders;

-- Remove anon UPDATE on attendance_records (kiosk only inserts)
DROP POLICY IF EXISTS "anon_update_attendance" ON attendance_records;

-- Keep anon SELECT and INSERT on attendance_records
-- (already created in previous migration, kept as-is)
