/*
# Corriger les métadonnées des comptes testeurs

1. Contexte
- Les comptes testeurs ont raw_user_meta_data et raw_app_meta_data vides.
- GoTrue a besoin de ces champs pour authentifier correctement l'utilisateur.
2. Modifications
- Met à jour raw_user_meta_data avec les mêmes champs que l'identité (sub, email, email_verified, phone_verified)
- Met à jour raw_app_meta_data avec provider et providers
3. Sécurité
- Aucune modification de schéma ni de politique RLS.
4. Notes
- Idempotent : peut être réexécuté sans effet secondaire.
*/

UPDATE auth.users
SET
  raw_user_meta_data = jsonb_build_object(
    'sub', id::text,
    'email', email,
    'email_verified', true,
    'phone_verified', false
  ),
  raw_app_meta_data = jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email')
  )
WHERE email IN ('estelle.pambou@distribution.ci', 'adelphe.malonga@distribution.ci');
