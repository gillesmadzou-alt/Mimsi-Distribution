-- Kiosk hardening: anonymous clients may read only a narrow view. All
-- attendance writes and photo uploads now go through the kiosk-checkin Edge
-- Function using the service role after server-side validation.

DROP POLICY IF EXISTS "anon_select_active_profiles" ON public.profiles;
DROP POLICY IF EXISTS "anon_select_active_drivers" ON public.drivers;
DROP POLICY IF EXISTS "anon_select_active_bakers" ON public.bakers;
DROP POLICY IF EXISTS "anon_select_active_kneaders" ON public.kneaders;
DROP POLICY IF EXISTS "anon_insert_attendance" ON public.attendance_records;
DROP POLICY IF EXISTS "anon_update_attendance" ON public.attendance_records;

REVOKE ALL ON public.profiles, public.drivers, public.bakers, public.kneaders, public.attendance_records FROM anon;
REVOKE ALL ON FUNCTION public.kiosk_find_open_attendance(text, date) FROM anon;

-- This view deliberately exposes only the identity fields required by the
-- physical kiosk. Views run as their owner, so no anonymous base-table policy
-- is needed (and therefore no phone, address, date of birth, or licence data
-- can be selected through PostgREST).
CREATE OR REPLACE VIEW public.kiosk_people
WITH (security_barrier = true)
AS
  SELECT id, full_name, role::integer AS role, 'profile'::text AS person_type
  FROM public.profiles
  WHERE is_active = true
  UNION ALL
  SELECT id, full_name, 10::integer AS role, 'driver'::text AS person_type
  FROM public.drivers
  WHERE status = 'actif'
  UNION ALL
  SELECT id, full_name, 9::integer AS role, 'baker'::text AS person_type
  FROM public.bakers
  WHERE status = 'actif'
  UNION ALL
  SELECT id, full_name, 8::integer AS role, 'kneader'::text AS person_type
  FROM public.kneaders
  WHERE status = 'actif';

REVOKE ALL ON public.kiosk_people FROM PUBLIC;
GRANT SELECT ON public.kiosk_people TO anon;

-- Attendance images contain biometric/personal information. Keep objects
-- private and let authorized staff use short-lived signed URLs.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'attendance-photos';

DROP POLICY IF EXISTS "anon_upload_attendance_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_attendance_photos" ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos_manager_read" ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos_manager_upload" ON storage.objects;

CREATE POLICY "attendance_photos_manager_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-photos' AND private.get_my_role() >= 4);

CREATE POLICY "attendance_photos_manager_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-photos' AND private.get_my_role() >= 4);
