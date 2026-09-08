-- Dissocie la fonction métier du niveau d'autorisation.
ALTER TABLE public.profiles ADD COLUMN access_level smallint;

UPDATE public.profiles
SET access_level = CASE
  WHEN role IN (1, 10, 11, 12, 13, 14) THEN 1
  WHEN role IN (2, 9, 15, 16) THEN 2
  WHEN role = 3 THEN 3
  WHEN role IN (4, 7, 8) THEN 4
  WHEN role = 5 THEN 5
  WHEN role = 6 THEN 6
  ELSE 1
END;

ALTER TABLE public.profiles
  ALTER COLUMN access_level SET DEFAULT 1,
  ALTER COLUMN access_level SET NOT NULL,
  ADD CONSTRAINT profiles_access_level_range CHECK (access_level BETWEEN 1 AND 6);

COMMENT ON COLUMN public.profiles.access_level IS
  'Niveau d’autorisation indépendant de la fonction métier, de 1 (base) à 6 (administration).';

REVOKE UPDATE (role, access_level, is_active) ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION private.get_my_role()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.access_level::integer
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.is_active = true;
$function$;
