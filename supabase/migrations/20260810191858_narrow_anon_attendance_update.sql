REVOKE UPDATE ON public.attendance_records FROM anon;
GRANT UPDATE (departure_time, departure_photo_url) ON public.attendance_records TO anon;

DROP POLICY IF EXISTS anon_update_attendance ON public.attendance_records;
CREATE POLICY anon_update_attendance ON public.attendance_records
  FOR UPDATE TO anon
  USING (recorded_by IS NULL AND departure_time IS NULL)
  WITH CHECK (recorded_by IS NULL);
