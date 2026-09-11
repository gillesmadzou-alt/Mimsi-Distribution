# Mise en place des notifications Web Push

## Ce qui existe déjà (code, déjà commité)

- `public/sw.js` : gère l'événement `push` (affiche la notification système)
  et `notificationclick` (ramène l'utilisateur sur la bonne page).
- `src/lib/webPush.ts` : `subscribeToPush()` / `unsubscribeFromPush()`
  côté navigateur.
- Bouton d'activation dans la cloche de notifications (`NotificationBell`).
- `supabase/migrations/20260911190000_add_push_notifications.sql` : table
  `push_subscriptions` + trigger qui appelle automatiquement la fonction
  Edge `send-push` à chaque nouvelle ligne dans `app_notifications`.
- `supabase/functions/send-push/index.ts` : envoie le push réel à chaque
  abonnement enregistré, via la librairie `web-push`.

## Étapes manuelles restantes (une seule fois par projet Supabase)

Une paire de clés VAPID a été générée localement (jamais envoyée à un
service tiers) et communiquée directement dans le chat — ne jamais les
committer dans un fichier du dépôt. La clé **publique** est déjà dans
`.env` (fichier local, non versionné) sous `VITE_VAPID_PUBLIC_KEY` ; il faut
aussi l'ajouter sur Vercel (variable `VITE_VAPID_PUBLIC_KEY`, comme les
autres `VITE_*`, puis « Redeploy »). Elle est publique par construction (le
« V » de VAPID) : aucun risque à l'afficher ou la committer, seule la privée
doit rester secrète.

La clé **privée** ne doit jamais être committée ni collée dans un champ par
un agent — à faire toi-même, avec les deux valeurs partagées dans le chat :

1. **Secrets de la fonction Edge `send-push`** (Dashboard Supabase → Edge
   Functions → `send-push` → Secrets, ou Project Settings → Edge Functions
   selon la version de l'UI) :
   - `VAPID_PUBLIC_KEY` = la clé publique générée
   - `VAPID_PRIVATE_KEY` = la clé privée générée
   - `VAPID_SUBJECT` = `mailto:gillesmadzou@gmail.com` (contact requis par la
     spec Web Push, jamais montré à l'utilisateur final)
   - `PUSH_TRIGGER_SECRET` = un secret de ton choix (génère-en un nouveau,
     par ex. avec un gestionnaire de mots de passe) — doit être
     **identique** à la valeur mise dans Vault à l'étape 2.

2. **Deux secrets Vault**, à créer une fois dans le SQL Editor Supabase
   (jamais dans une migration versionnée, pour ne pas les committer) :

   ```sql
   select vault.create_secret('https://<ton-ref>.supabase.co', 'project_url');
   select vault.create_secret('<la même valeur que PUSH_TRIGGER_SECRET ci-dessus>', 'push_trigger_secret');
   ```

   Remplace `<ton-ref>` par la référence du projet Supabase réellement en
   production (actuellement celui géré par Bolt ; à refaire sur le projet
   « Mimsi » une fois la migration terminée).

3. **Déployer la fonction Edge** :

   ```bash
   supabase functions deploy send-push
   ```

Tant que ces secrets ne sont pas configurés, le trigger Postgres ne bloque
rien (il renonce silencieusement à l'envoi push si les secrets Vault sont
absents) — l'application continue de fonctionner normalement, les
notifications in-app restent visibles dans la cloche comme avant.

## Test

1. Se connecter à l'application, cliquer sur la cloche de notifications →
   « Activer les notifications push » → accepter la permission du navigateur.
2. Créer une notification test (ex: une action qui insère dans
   `app_notifications`) et vérifier qu'une notification système apparaît
   même avec l'onglet en arrière-plan ou fermé.
3. `supabase functions logs send-push` pour diagnostiquer un échec d'envoi.
