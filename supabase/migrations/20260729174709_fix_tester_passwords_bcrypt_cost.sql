/*
# Corriger les mots de passe des comptes testeurs avec bcrypt coût 10

1. Modifications
- Met à jour le mot de passe de estelle.pambou@distribution.ci → Estelle2026! avec bcrypt coût 10
- Met à jour le mot de passe de adelphe.malonga@distribution.ci → Adelphe2026! avec bcrypt coût 10
2. Sécurité
- Aucune modification de schéma ni de politique RLS.
3. Notes
- Supabase GoTrue attend bcrypt avec un coût de 10 ($2a$10$), pas 6.
- La migration précédente utilisait gen_salt('bf') qui produit un coût de 6 par défaut.
- Aucune donnée utilisateur perdue.
*/

UPDATE auth.users
SET encrypted_password = crypt('Estelle2026!', gen_salt('bf', 10))
WHERE email = 'estelle.pambou@distribution.ci';

UPDATE auth.users
SET encrypted_password = crypt('Adelphe2026!', gen_salt('bf', 10))
WHERE email = 'adelphe.malonga@distribution.ci';
