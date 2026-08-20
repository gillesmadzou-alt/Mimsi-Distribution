/*
# Create login accounts for all staff members

1. Context
- 4 drivers, 5 bakers, and 1 kneader exist in the database but have no login accounts.
- This migration creates auth.users entries + profiles entries for each person.
- Passwords follow the existing pattern: FirstName + "2026!" (e.g. "Benicia2026!").
- Emails use firstname.lastname@distribution.ci pattern.
- Roles: driver = 1, baker = 2, kneader = 3.

2. Accounts created
Drivers (role 1):
  - benicia.bifouma@distribution.ci / Benicia2026!
  - davina.kanda@distribution.ci / Davina2026!
  - estelvie.mikamona@distribution.ci / Estelvie2026!
  - dhieny.ngoma@distribution.ci / Dhieny2026!

Bakers (role 2):
  - ruanchadrack.benazo@distribution.ci / Ruan2026!
  - presney.malonga@distribution.ci / Presney2026!
  - ornich.massengo@distribution.ci / Ornich2026!
  - exaucee.miakalou@distribution.ci / Exaucee2026!
  - dieudonne.mwakadi@distribution.ci / Dieudonne2026!

Kneader (role 3):
  - nordelin.koukassanadiandaya@distribution.ci / Nordelin2026!

3. Security
- No schema changes, no RLS changes.
- All accounts created with email_confirm = true (no confirmation email needed).
- Passwords hashed with bcrypt cost 10 (Supabase GoTrue standard).

4. Idempotency
- Uses NOT EXISTS checks so re-running won't create duplicates.
*/

-- Drivers (role 1)
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'benicia.bifouma@distribution.ci', crypt('Benicia2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'benicia.bifouma@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'davina.kanda@distribution.ci', crypt('Davina2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'davina.kanda@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'estelvie.mikamona@distribution.ci', crypt('Estelvie2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'estelvie.mikamona@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'dhieny.ngoma@distribution.ci', crypt('Dhieny2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'dhieny.ngoma@distribution.ci');

-- Bakers (role 2)
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'ruanchadrack.benazo@distribution.ci', crypt('Ruan2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'ruanchadrack.benazo@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'presney.malonga@distribution.ci', crypt('Presney2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'presney.malonga@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'ornich.massengo@distribution.ci', crypt('Ornich2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'ornich.massengo@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'exaucee.miakalou@distribution.ci', crypt('Exaucee2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'exaucee.miakalou@distribution.ci');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'dieudonne.mwakadi@distribution.ci', crypt('Dieudonne2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'dieudonne.mwakadi@distribution.ci');

-- Kneader (role 3)
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'nordelin.koukassanadiandaya@distribution.ci', crypt('Nordelin2026!', gen_salt('bf', 10)), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'nordelin.koukassanadiandaya@distribution.ci');

-- Create identities for all new users (required for GoTrue authentication)
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now()
FROM auth.users u
WHERE u.email IN (
  'benicia.bifouma@distribution.ci',
  'davina.kanda@distribution.ci',
  'estelvie.mikamona@distribution.ci',
  'dhieny.ngoma@distribution.ci',
  'ruanchadrack.benazo@distribution.ci',
  'presney.malonga@distribution.ci',
  'ornich.massengo@distribution.ci',
  'exaucee.miakalou@distribution.ci',
  'dieudonne.mwakadi@distribution.ci',
  'nordelin.koukassanadiandaya@distribution.ci'
)
AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);

-- Create profiles for all new users
INSERT INTO profiles (id, full_name, role, is_active)
SELECT u.id, d.full_name, d.role, true
FROM auth.users u
JOIN (
  SELECT 'benicia.bifouma@distribution.ci' AS email, 'BIFOUMA Bénicia' AS full_name, 1 AS role
  UNION ALL SELECT 'davina.kanda@distribution.ci', 'KANDA Davina', 1
  UNION ALL SELECT 'estelvie.mikamona@distribution.ci', 'MIKAMONA Estelvie', 1
  UNION ALL SELECT 'dhieny.ngoma@distribution.ci', 'NGOMA Dhieny', 1
  UNION ALL SELECT 'ruanchadrack.benazo@distribution.ci', 'BENAZO Ruan chadrack', 2
  UNION ALL SELECT 'presney.malonga@distribution.ci', 'MALONGA Presney', 2
  UNION ALL SELECT 'ornich.massengo@distribution.ci', 'MASSENGO Ornich', 2
  UNION ALL SELECT 'exaucee.miakalou@distribution.ci', 'MIAKALOU Exaucée', 2
  UNION ALL SELECT 'dieudonne.mwakadi@distribution.ci', 'MWAKADI Dieudonné', 2
  UNION ALL SELECT 'nordelin.koukassanadiandaya@distribution.ci', 'KOUKASSANADIANDAYA Nordelin', 3
) d ON d.email = u.email
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);
