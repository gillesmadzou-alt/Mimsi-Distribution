/*
# Créer les identités manquantes pour les comptes testeurs

1. Contexte
- Les comptes testeurs (estelle.pambou@distribution.ci et adelphe.malonga@distribution.ci)
  existent dans auth.users mais n'ont pas d'entrée dans auth.identities.
- Sans identité, Supabase GoTrue ne peut pas authentifier l'utilisateur et renvoie
  "Database error querying schema" lors de la connexion.
2. Modifications
- Insère une identité "email" pour chaque compte testeur, en répliquant le format
  de l'identité du compte admin existant.
3. Sécurité
- Aucune modification de schéma ni de politique RLS.
4. Notes
- La colonne "email" est générée automatiquement depuis identity_data, donc on ne l'insère pas.
- Idempotent : utilise NOT EXISTS pour éviter les doublons.
*/

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
WHERE u.email IN ('estelle.pambou@distribution.ci', 'adelphe.malonga@distribution.ci')
AND NOT EXISTS (
  SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
);
