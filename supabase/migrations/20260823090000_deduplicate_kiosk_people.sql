-- The kiosk must show one identity per real person. Personnel entries linked
-- to an active profile previously appeared twice (profile + job record).
-- Keep the active profile first, then fall back to the operational record.
CREATE OR REPLACE VIEW public.kiosk_people
WITH (security_barrier = true)
AS
WITH people AS (
  SELECT
    id,
    full_name,
    role::integer AS role,
    'profile'::text AS person_type,
    1 AS source_priority
  FROM public.profiles
  WHERE is_active = true

  UNION ALL

  SELECT
    id,
    full_name,
    10::integer AS role,
    'driver'::text AS person_type,
    2 AS source_priority
  FROM public.drivers
  WHERE status = 'actif'

  UNION ALL

  SELECT
    id,
    full_name,
    9::integer AS role,
    'baker'::text AS person_type,
    3 AS source_priority
  FROM public.bakers
  WHERE status = 'actif'

  UNION ALL

  SELECT
    id,
    full_name,
    8::integer AS role,
    'kneader'::text AS person_type,
    4 AS source_priority
  FROM public.kneaders
  WHERE status = 'actif'
)
SELECT DISTINCT ON (lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')))
  id,
  full_name,
  role,
  person_type
FROM people
WHERE trim(full_name) <> ''
ORDER BY
  lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')),
  source_priority,
  full_name;

REVOKE ALL ON public.kiosk_people FROM PUBLIC;
GRANT SELECT ON public.kiosk_people TO anon;
