/*
# Réinitialiser les mots de passe des comptes testeurs

1. Modifications
- Met à jour le mot de passe de estelle.pambou@distribution.ci → Estelle2026!
- Met à jour le mot de passe de adelphe.malonga@distribution.ci → Adelphe2026!
2. Sécurité
- Aucune modification de schéma ni de politique RLS.
- Les deux comptes existent déjà avec les bons rôles (5 et 4) et sont actifs.
3. Notes
- Utilise crypt() avec pggen_salt bf pour hasher selon le format attendu par auth.users.
- Aucune donnée utilisateur perdue.
*/

-- Estelle PAMBOU (rôle 5 — Directrice)
UPDATE auth.users
SET encrypted_password = crypt('Estelle2026!', gen_salt('bf'))
WHERE email = 'estelle.pambou@distribution.ci';

-- Adelphe MALONGA (rôle 4 — Directeur adjoint)
UPDATE auth.users
SET encrypted_password = crypt('Adelphe2026!', gen_salt('bf'))
WHERE email = 'adelphe.malonga@distribution.ci';
