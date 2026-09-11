# Audit de dérive de schéma (schema drift)

## Pourquoi

Le 11/09/2026 on a découvert que la base de production avait **8 tables
manquantes** (`accounting_entries`, `equipment_assets`, `inventory_sessions`,
`inventory_entries`, `inventory_schedules`, `inventory_session_lines`,
`deposit_barcodes`, `delivery_batch_approvals`) parce qu'un lot de migrations
(17/08 → 11/09) n'avait jamais été appliqué à la base réelle, alors qu'il
existait bien dans `supabase/migrations/`. Les pages qui dépendaient de ces
tables plantaient silencieusement en production sans qu'aucune alerte ne le
signale.

Cette procédure sert à détecter ce genre de dérive **avant** qu'un
utilisateur ne tombe sur l'erreur.

## Vérification rapide (recommandé après chaque déploiement)

```bash
npm run schema:audit
```

Ceci exécute `supabase migration list --linked` : la CLI liste, côte à côte,
les migrations connues localement (dans `supabase/migrations/`) et celles
réellement enregistrées comme appliquées dans la base liée (table
`supabase_migrations.schema_migrations`). Toute ligne où une seule des deux
colonnes est remplie signale une dérive :

- migration **locale uniquement** → elle n'a jamais été appliquée à la base
  → lancer `supabase db push --linked` pour la rattraper.
- migration **distante uniquement** → une migration a été appliquée à la
  base sans passer par un fichier versionné dans le repo (arrive quand on
  modifie le schéma à la main depuis le SQL Editor) → il faut créer le
  fichier de migration correspondant après coup (`supabase db diff`) pour
  que le repo reflète l'état réel de la base.

Nécessite d'avoir lié le projet une fois (`supabase link --project-ref
<ref>`) et d'être authentifié (`supabase login`) — l'utilisateur doit lancer
cette commande lui-même, elle n'est pas exécutée automatiquement par Claude
Code.

## Vérification approfondie (diff complet du schéma)

```bash
supabase db diff --linked --schema public,private -f drift-check
```

Génère un fichier de migration dans `supabase/migrations/` contenant *tout*
ce qui diffère entre le schéma local (migrations rejouées sur une base
shadow) et le schéma distant réel. Un fichier vide généré = pas de dérive.
Si le fichier contient des `CREATE TABLE`/`ALTER TABLE`, c'est le signe que
des changements existent en base sans migration correspondante (ou
inversement) — à examiner avant de le committer ou de le supprimer.

## Recommandation

Lancer `npm run schema:audit` :
- après chaque session de travail avec Bolt.new (qui applique parfois des
  migrations sans que ce soit visible immédiatement dans l'interface),
- avant toute mise en production importante,
- si une page de l'application affiche une erreur Supabase du type
  `relation "..." does not exist`.
