# Sauvegarde et restauration

Deux dispositifs complémentaires. Ils ne protègent pas des mêmes choses, et
aucun ne remplace l'autre.

| | PITR (Supabase) | Sauvegarde logique (ce dépôt) |
|---|---|---|
| Protège de | une erreur humaine récente : `DELETE` sans `WHERE`, migration ratée | la perte du projet : compte suspendu, suppression, litige avec le fournisseur, région indisponible |
| Granularité | à la seconde près | une fois par jour |
| Rétention | 7 jours (selon l'option souscrite) | 90 jours en CI, illimitée hors site |
| Où vivent les données | chez Supabase, avec le projet | hors de chez Supabase |
| Mise en place | tableau de bord Supabase, payante | déjà en place, gratuite |
| Restauration | quelques clics, le projet revient à l'instant T | `pg_restore` dans un projet neuf |

Le PITR seul est un piège : si le compte Supabase est fermé, le PITR part avec.
La sauvegarde logique seule est un piège aussi : elle date d'au plus 24 h, ce
qui peut représenter une journée entière de commandes.

---

## 1. PITR — à activer dans le tableau de bord

**Cette partie ne peut pas être automatisée depuis le dépôt.** Le PITR est une
option payante du projet Supabase, activable uniquement depuis l'interface.

1. Le PITR exige le plan **Pro** (le plan gratuit ne conserve aucune sauvegarde
   au-delà de quelques jours, et pas de PITR du tout).
2. Tableau de bord Supabase → le projet → **Settings** → **Add-ons** →
   **Point in Time Recovery** → choisir la rétention (7 jours suffit pour
   rattraper une erreur humaine ; au-delà, c'est la sauvegarde logique qui prend
   le relais).
3. Vérifier ensuite dans **Database** → **Backups** que l'onglet
   **Point in Time** affiche bien une fenêtre de restauration qui avance.

> Tarifs et libellés d'interface changent régulièrement : vérifier le coût réel
> dans le tableau de bord avant d'activer. Compter l'option en plus du plan Pro.

**Restaurer avec le PITR** : Database → Backups → Point in Time → choisir la
date et l'heure → confirmer. Le projet redevient ce qu'il était à cet instant.
C'est une opération **destructive et irréversible** : tout ce qui a été écrit
après l'instant choisi est perdu. Avant de la lancer, prendre une sauvegarde
logique manuelle (`workflow_dispatch`, voir plus bas) pour garder une trace de
l'état actuel.

---

## 2. Sauvegarde logique — en place

Tous les jours à 02h10 UTC (03h10 à Brazzaville), `.github/workflows/backup.yml`
exécute `scripts/backup-database.sh`, qui :

1. **extrait** les schémas `public`, `private` et `auth` avec `pg_dump` ;
2. **refuse** un dump anormalement petit, pour ne pas remplacer une bonne
   sauvegarde par une mauvaise ;
3. **restaure** l'extraction dans une base jetable et compare **table par table
   et ligne par ligne** avec la source — en cas d'écart, le script s'arrête et
   n'écrit aucune archive ;
4. **chiffre** en AES-256 via `age`, avec une clé publique ;
5. **relit l'en-tête** du fichier produit pour s'assurer qu'il est bien chiffré.

### Pourquoi ces trois schémas et pas seulement `public`

Une extraction limitée à `public` **ne se restaure nulle part**. Les colonnes de
`public` ont des valeurs par défaut `auth.uid()` et leurs triggers et policies
appellent `private.*` : la restauration échoue dès le premier `CREATE TABLE`
avec « schema auth does not exist ». Et sans le schéma `auth`, on restaurerait
des données dont les clés étrangères pointent vers des comptes disparus —
personne ne pourrait plus se connecter.

### Pourquoi une clé publique et pas un mot de passe partagé

La machine qui sauvegarde ne détient que de quoi **chiffrer**. Si la CI est
compromise, l'attaquant peut au pire écrire de nouvelles archives ; il ne peut
pas lire les anciennes. La clé privée ne quitte jamais le coffre de la direction.

### Mise en service

Générer la paire de clés, **une seule fois, sur un poste de confiance** :

```bash
age-keygen -o cle-sauvegarde-mimsi.txt
```

- La ligne `# public key: age1...` → secret GitHub `BACKUP_AGE_RECIPIENT`.
- Le **fichier entier** → gestionnaire de mots de passe de la direction, et une
  copie papier en coffre. **Perdre cette clé rend toutes les sauvegardes
  définitivement illisibles.** C'est le point de défaillance unique du
  dispositif : le traiter comme les statuts de la société.
- Ne jamais committer ce fichier. Ne jamais l'envoyer par WhatsApp ni par mail.

Deux secrets à créer dans **Settings → Secrets and variables → Actions** :

| Secret | Contenu |
|---|---|
| `SUPABASE_DB_URL` | chaîne de connexion Postgres du projet, **pooler en mode session** (le mode transaction interrompt `pg_dump`) |
| `BACKUP_AGE_RECIPIENT` | la clé publique `age1...` |

Pour chiffrer à destination de plusieurs personnes (associé, comptable),
séparer les clés publiques par des virgules : chacune pourra déchiffrer seule.

### Sauvegarde manuelle avant une opération risquée

Avant toute migration lourde ou restauration PITR : onglet **Actions** →
**Sauvegarde de la base** → **Run workflow**.

---

## 3. Restaurer — marche à suivre

À dérouler dans l'ordre, sans sauter la première ligne.

```bash
# 0. Ne JAMAIS restaurer par-dessus la base sinistrée avant de l'avoir copiée :
#    on perdrait les indices de ce qui s'est passé.

# 1. Récupérer l'archive (onglet Actions → l'exécution voulue → Artifacts)
#    puis la déchiffrer avec la clé privée du coffre.
age -d -i cle-sauvegarde-mimsi.txt mimsi-20260917T021000Z.dump.age > restauration.dump

# 2. Créer un projet Supabase NEUF (ne pas écraser l'ancien) et récupérer sa
#    chaîne de connexion.

# 3. Préparer la cible (rôles de la plateforme et schéma extensions).
psql "$NOUVELLE_URL" -f supabase/tests/_restore_prerequisites.sql

# 4. Restaurer.
pg_restore --no-owner --no-privileges --no-acl -d "$NOUVELLE_URL" restauration.dump

# 5. Vérifier que le cloisonnement a survécu — c'est ce qui compte le plus.
psql "$NOUVELLE_URL" -f supabase/tests/tenant_isolation_test.sql

# 6. Repointer l'application : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY,
#    puis redéployer.

# 7. Reconfigurer les secrets des Edge Functions — ils ne sont PAS dans le dump :
#    TOKEN_ENCRYPTION_KEY (sans elle, les jetons sociaux restaurés sont
#    illisibles et tous les clients devront reconnecter leurs comptes),
#    META_VERIFY_TOKEN, VAPID_*, PAWAPAY_API_TOKEN, CINETPAY_*.
```

> `TOKEN_ENCRYPTION_KEY` mérite le même traitement que la clé de sauvegarde :
> coffre, copie papier. Elle ne figure dans aucune sauvegarde, par construction.

### Vérifier la restauration une fois par trimestre

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Le script vérifie
chaque nuit que l'archive **est restaurable**, mais il ne vérifie pas que
**l'équipe sait la restaurer**. Une fois par trimestre, dérouler la procédure
ci-dessus en entier sur un projet jetable, chronomètre en main, et corriger ce
document là où il s'est révélé faux.

---

## 4. Hors site — reste à faire

Les archives vivent aujourd'hui dans les artefacts GitHub Actions, avec une
rétention plafonnée à **90 jours** par GitHub. C'est court au regard des
obligations comptables SYSCOHADA, qui se comptent en années.

Deux pistes, à trancher :

- **Stockage objet** (Backblaze B2, Scaleway, OVH) : quelques euros par an,
  rétention libre, règle de cycle de vie pour garder par exemple les archives
  mensuelles pendant dix ans. Ajouter une étape `rclone`/`aws s3 cp` au
  workflow, après le chiffrement.
- **Copie manuelle mensuelle** sur un disque externe conservé hors des locaux.
  Rustique, mais réellement hors ligne — donc à l'abri d'un rançongiciel qui
  aurait les accès du cloud.

Idéalement les deux : la règle des 3-2-1 (trois copies, deux supports, une hors
site) n'a pas d'équivalent plus simple.

---

## 5. Avertissement : données personnelles dans le dépôt

`scripts/data-export.sql` contient **327 lignes de données réelles** — dont les
noms complets de treize salariés — et il est commité dans un dépôt **public**.
C'est l'inverse de ce que ce document met en place : une sauvegarde doit être
chiffrée et hors de portée, pas en clair sur une page web indexable.

Le supprimer du dépôt ne suffit pas : il reste dans l'historique git, accessible
à quiconque clone. Le retirer vraiment demande une réécriture de l'historique
(`git filter-repo`) et un `push --force`, ce qui casse toutes les copies
existantes — décision qui appartient à la direction, pas à un outil.

Trois options, par ordre de préférence :

1. **Passer le dépôt en privé**, puis retirer le fichier. Le plus simple et le
   plus sûr ; l'historique reste, mais n'est plus public.
2. **Réécrire l'historique** pour effacer le fichier, et considérer les données
   comme ayant fuité (prévenir les personnes concernées si la loi locale
   l'impose).
3. Ne rien faire, en connaissance de cause. À éviter : ces données sont celles
   d'employés qui n'ont pas consenti à leur publication.
