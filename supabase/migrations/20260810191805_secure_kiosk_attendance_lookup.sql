DROP POLICY IF EXISTS anon_select_attendance ON public.attendance_records;

CREATE OR REPLACE FUNCTION public.kiosk_find_open_attendance(p_person_name text, p_date date)
RETURNS TABLE (id uuid, departure_time time)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.departure_time
  FROM public.attendance_records a
  WHERE a.person_name = p_person_name
    AND a.attendance_date = p_date
    AND a.recorded_by IS NULL
  ORDER BY a.arrival_time DESC NULLS LAST
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_find_open_attendance(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_find_open_attendance(text, date) TO anon, authenticated;
