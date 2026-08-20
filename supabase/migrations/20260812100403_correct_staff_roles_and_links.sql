/*
# Correct staff roles and personnel links

1. Purpose
- Correct the six production accounts that were assigned the wrong roles.
- Keep the four commercial accounts as role 1.
- Assign the five former baker records and one kneader record to the Pétrisseur role (role 9).
- Link each login account to the matching personnel record so personal dashboards and permissions work.

2. Changes
- Updates profiles.role for six production accounts from incorrect values to role 9.
- Links four commercial profiles to drivers.user_id.
- Links five production profiles to bakers.profile_id.
- Links one production profile to kneaders.profile_id.

3. Security
- No tables, columns, or policies are removed.
- Existing accounts and passwords are preserved.
- Only the matching personnel records are updated.

4. Important notes
- Role 1 is displayed as Commercial.
- Role 9 is displayed as Pétrisseur.
*/

UPDATE profiles
SET role = 9, updated_at = now()
WHERE id IN (
  (SELECT id FROM auth.users WHERE email = 'ruanchadrack.benazo@distribution.ci'),
  (SELECT id FROM auth.users WHERE email = 'presney.malonga@distribution.ci'),
  (SELECT id FROM auth.users WHERE email = 'ornich.massengo@distribution.ci'),
  (SELECT id FROM auth.users WHERE email = 'exaucee.miakalou@distribution.ci'),
  (SELECT id FROM auth.users WHERE email = 'dieudonne.mwakadi@distribution.ci'),
  (SELECT id FROM auth.users WHERE email = 'nordelin.koukassanadiandaya@distribution.ci')
);

UPDATE drivers d
SET user_id = u.id, updated_at = now()
FROM auth.users u
WHERE (d.full_name = 'BIFOUMA Bénicia' AND u.email = 'benicia.bifouma@distribution.ci')
   OR (d.full_name = 'KANDA Davina' AND u.email = 'davina.kanda@distribution.ci')
   OR (d.full_name = 'MIKAMONA Estelvie' AND u.email = 'estelvie.mikamona@distribution.ci')
   OR (d.full_name = 'NGOMA Dhieny' AND u.email = 'dhieny.ngoma@distribution.ci');

UPDATE bakers b
SET profile_id = u.id, updated_at = now()
FROM auth.users u
WHERE (b.full_name = 'BENAZO Ruan chadrack' AND u.email = 'ruanchadrack.benazo@distribution.ci')
   OR (b.full_name = 'MALONGA Presney' AND u.email = 'presney.malonga@distribution.ci')
   OR (b.full_name = 'MASSENGO Ornich' AND u.email = 'ornich.massengo@distribution.ci')
   OR (b.full_name = 'MIAKALOU Exaucée' AND u.email = 'exaucee.miakalou@distribution.ci')
   OR (b.full_name = 'MWAKADI Dieudonné' AND u.email = 'dieudonne.mwakadi@distribution.ci');

UPDATE kneaders k
SET profile_id = u.id, updated_at = now()
FROM auth.users u
WHERE k.full_name = 'KOUKASSANADIANDAYA Nordelin'
  AND u.email = 'nordelin.koukassanadiandaya@distribution.ci';
