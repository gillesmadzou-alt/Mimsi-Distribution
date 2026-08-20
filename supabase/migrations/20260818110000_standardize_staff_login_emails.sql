-- Standardise les identifiants des comptes non administrateurs.
-- Format: nom.prenom@mimsidistribution.com (le nom complet est stocké nom puis prénom).
-- Le compte administrateur (role 6) est volontairement exclu.
CREATE OR REPLACE FUNCTION public.staff_login_email(full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '.' FROM regexp_replace(
    lower(translate(coalesce(full_name, ''),
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝŸýÿ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYYyy')),
    '[^a-z0-9]+', '.', 'g'
  )) || '@mimsidistribution.com';
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.role <> 6
    GROUP BY public.staff_login_email(p.full_name)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Deux utilisateurs ou plus génèrent la même adresse e-mail. Corrigez leurs noms avant d''appliquer la migration.';
  END IF;
END;
$$;

WITH mapped AS (
  SELECT p.id, public.staff_login_email(p.full_name) AS email
  FROM public.profiles p
  WHERE p.role <> 6
)
UPDATE auth.users u
SET email = mapped.email,
    raw_user_meta_data = jsonb_set(coalesce(u.raw_user_meta_data, '{}'::jsonb), '{email}', to_jsonb(mapped.email), true),
    updated_at = now()
FROM mapped
WHERE u.id = mapped.id
  AND u.email IS DISTINCT FROM mapped.email;

WITH mapped AS (
  SELECT p.id, public.staff_login_email(p.full_name) AS email
  FROM public.profiles p
  WHERE p.role <> 6
)
UPDATE auth.identities i
SET identity_data = jsonb_set(coalesce(i.identity_data, '{}'::jsonb), '{email}', to_jsonb(mapped.email), true),
    updated_at = now()
FROM mapped
WHERE i.user_id = mapped.id
  AND i.provider = 'email';

