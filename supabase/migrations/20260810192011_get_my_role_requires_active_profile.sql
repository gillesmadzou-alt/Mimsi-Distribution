CREATE OR REPLACE FUNCTION private.get_my_role()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true;
$function$;
