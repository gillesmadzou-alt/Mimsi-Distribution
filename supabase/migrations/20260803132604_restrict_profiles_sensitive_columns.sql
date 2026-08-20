/*
# Restreindre l'accès aux colonnes sensibles de profiles

1. Contexte
- Les colonnes `role` et `is_active` de la table profiles peuvent être modifiées
  par tout utilisateur authentifié via une requête directe, contournant l'interface.
- La fonction toggle_user_active gère désormais l'activation/désactivation.
- Le rôle ne doit être défini qu'à la création du compte (via la fonction create-user).

2. Modifications
- Révoque UPDATE sur les colonnes role et is_active pour authenticated
- Garde SELECT pour tous les utilisateurs authentifiés (ils ont besoin de voir les rôles)
- Les admins passent par la fonction toggle_user_active pour is_active
*/

REVOKE UPDATE (role, is_active) ON profiles FROM authenticated;
