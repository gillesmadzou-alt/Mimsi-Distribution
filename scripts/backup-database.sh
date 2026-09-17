#!/usr/bin/env bash
# Sauvegarde chiffree de la base, verifiee par une restauration reelle.
#
#   ./scripts/backup-database.sh
#
# Variables d'environnement :
#   DATABASE_URL           chaine de connexion Postgres (obligatoire)
#   BACKUP_AGE_RECIPIENT   cle PUBLIQUE age des destinataires (obligatoire)
#                          plusieurs cles : les separer par des virgules
#   BACKUP_DIR             repertoire de sortie (defaut : ./backups)
#   BACKUP_VERIFY          0 pour sauter la restauration de controle
#                          (defaut : 1 -- ne le desactiver qu'en connaissance
#                          de cause, une sauvegarde non restauree n'est pas
#                          une sauvegarde)
#   BACKUP_VERIFY_URL      Postgres jetable pour la verification
#                          (defaut : postgres://postgres@/postgres?host=/tmp&port=5433)
#
# Pourquoi une cle PUBLIQUE et non un mot de passe partage : la machine qui
# sauvegarde n'a jamais de quoi dechiffrer. Si la CI est compromise, l'attaquant
# peut au pire ecrire de nouvelles sauvegardes, jamais lire les anciennes. La
# cle privee ne sort pas du coffre de la direction.
#
# Generer la paire une seule fois, sur un poste de confiance :
#   age-keygen -o cle-sauvegarde-mimsi.txt
#   # la ligne « public key: age1... » va dans BACKUP_AGE_RECIPIENT
#   # le fichier entier va dans un gestionnaire de mots de passe, PAS dans git

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL est obligatoire}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT est obligatoire (cle publique age)}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_VERIFY="${BACKUP_VERIFY:-1}"
BACKUP_VERIFY_URL="${BACKUP_VERIFY_URL:-postgres://postgres@/postgres?host=/tmp&port=5433}"

# Taille plancher : un dump de cette base fait plusieurs centaines de kilo-octets.
# En dessous, quelque chose s'est mal passe (connexion refusee, base vide,
# permissions) et il ne faut surtout pas ecraser une bonne sauvegarde par celle-ci.
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-50000}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dump="$work/mimsi-$stamp.dump"
out="$BACKUP_DIR/mimsi-$stamp.dump.age"

echo "→ extraction (pg_dump, format custom)"
# Perimetre : public NE SUFFIT PAS. Les colonnes de `public` ont des valeurs
# par defaut `auth.uid()` et leurs triggers et policies appellent `private.*` ;
# un dump limite a public echoue des le premier CREATE TABLE a la restauration
# (« schema auth does not exist »). Il serait restaurable nulle part -- une
# sauvegarde qui ne se restaure pas est un fichier, pas une sauvegarde.
#
# `auth` porte en plus les comptes eux-memes : sans elle, on restaure des
# donnees dont les cles etrangeres pointent vers des utilisateurs disparus, et
# plus personne ne peut se connecter.
#
# --format=custom : permet une restauration selective (une table, un schema)
#   plutot que du tout-ou-rien, et compresse au passage.
# --no-owner / --no-privileges : proprietaires et roles different entre
#   Supabase et la base de restauration ; sans ca la restauration echoue sur
#   des roles inexistants.
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=private \
  --schema=auth \
  --file="$dump"

size=$(stat -c %s "$dump")
if [ "$size" -lt "$MIN_DUMP_BYTES" ]; then
  echo "ECHEC : dump de $size octets, sous le plancher de $MIN_DUMP_BYTES." >&2
  echo "Aucune sauvegarde ecrite. Verifier la connexion et les droits." >&2
  exit 1
fi
echo "  $(numfmt --to=iec "$size" 2>/dev/null || echo "$size octets")"

tables=$(pg_restore --list "$dump" | grep -c 'TABLE DATA' || true)
echo "  $tables tables avec donnees"

# ---------------------------------------------------------------------------
# Verification par restauration reelle
# ---------------------------------------------------------------------------
# On restaure AVANT de chiffrer, pendant que le clair est encore disponible.
# La machine de sauvegarde n'a donc jamais besoin de la cle privee, et on sait
# quand meme que l'archive est restaurable. Une sauvegarde jamais restauree
# n'est pas une sauvegarde : c'est un fichier.
if [ "$BACKUP_VERIFY" = "1" ]; then
  echo "→ verification : restauration dans une base jetable"
  # Postgres replie les identifiants non quotes en minuscules : sans le
  # tr, on cree « verify_...t...z » puis on tente de joindre
  # « verify_...T...Z », qui n'existe pas.
  verify_db="verify_$(echo "$stamp" | tr 'A-Z' 'a-z')"
  base_url="${BACKUP_VERIFY_URL%%\?*}"
  params="${BACKUP_VERIFY_URL#*\?}"
  [ "$params" = "$BACKUP_VERIFY_URL" ] && params=""

  admin_url="$BACKUP_VERIFY_URL"
  target_url="${base_url%/*}/$verify_db${params:+?$params}"

  psql "$admin_url" -q -c "DROP DATABASE IF EXISTS $verify_db;" -c "CREATE DATABASE $verify_db;"
  # Une restauration reelle vise un projet Supabase neuf, qui fournit deja les
  # roles de la plateforme et le schema `extensions`. On reproduit ces prerequis
  # ici, sinon la restauration echoue sur des objets sans rapport avec les
  # donnees et le controle signale un faux positif.
  prereq="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/tests/_restore_prerequisites.sql"
  if [ ! -f "$prereq" ]; then
    echo "ECHEC : prerequis de restauration introuvables ($prereq)." >&2
    echo "Sans eux, la restauration de controle echoue pour une raison qui n'a" >&2
    echo "rien a voir avec la qualite de la sauvegarde." >&2
    exit 1
  fi
  if ! psql "$target_url" -q -f "$prereq" >"$work/prereq.log" 2>&1; then
    echo "ECHEC : preparation de la base de controle impossible." >&2
    head -5 "$work/prereq.log" >&2
    exit 1
  fi

  # --no-acl : les GRANT visent des roles Supabase absents ici.
  pg_restore --no-owner --no-privileges --no-acl --dbname="$target_url" "$dump" \
    > "$work/restore.log" 2>&1 || true

  # --------------------------------------------------------------------------
  # Comparaison stricte source <-> restauration.
  # --------------------------------------------------------------------------
  # Compter « au moins une table » ne prouve rien : une restauration qui echoue
  # a la premiere table en cree quand meme quelques-unes avant de s'arreter.
  # On compare donc table par table, et le nombre de lignes de chacune.
  fingerprint_sql="SELECT string_agg(t || ':' || n, ',' ORDER BY t) FROM (
      SELECT c.relname AS t,
             (SELECT count(*) FROM pg_class x WHERE x.oid = c.oid) * 0
             + COALESCE((xpath('/row/c/text()',
                 query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                              false, true, '')))[1]::text::bigint, 0) AS n
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
    ) s;"

  src_fp=$(psql "$DATABASE_URL" -tAc "$fingerprint_sql")
  dst_fp=$(psql "$target_url"   -tAc "$fingerprint_sql")

  src_tables=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")
  dst_tables=$(psql "$target_url"   -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")

  if [ "$src_fp" != "$dst_fp" ]; then
    echo "ECHEC : la restauration ne correspond pas a la source." >&2
    echo "  tables source : $src_tables, restaurees : $dst_tables" >&2
    echo "  premieres erreurs de pg_restore :" >&2
    grep -m 5 "^pg_restore: error" "$work/restore.log" >&2 || true
    echo "  AUCUNE sauvegarde ecrite : une archive non restaurable est pire qu'aucune," >&2
    echo "  parce qu'on croit en avoir une." >&2
    psql "$admin_url" -q -c "DROP DATABASE IF EXISTS $verify_db;"
    exit 1
  fi

  total_rows=$(psql "$target_url" -tAc "
    SELECT COALESCE(sum((regexp_match(x, ':([0-9]+)\$'))[1]::bigint), 0)
      FROM unnest(string_to_array('$dst_fp', ',')) x;" 2>/dev/null || echo "?")
  psql "$admin_url" -q -c "DROP DATABASE IF EXISTS $verify_db;"

  echo "  $dst_tables tables et $total_rows lignes restaurees, identiques a la source"
else
  echo "→ verification SAUTEE (BACKUP_VERIFY=0)"
fi

# ---------------------------------------------------------------------------
# Chiffrement
# ---------------------------------------------------------------------------
echo "→ chiffrement (age, cle publique)"
recipients=()
IFS=',' read -ra keys <<< "$BACKUP_AGE_RECIPIENT"
for k in "${keys[@]}"; do
  k="$(echo "$k" | xargs)"
  [ -n "$k" ] && recipients+=(-r "$k")
done
age "${recipients[@]}" -o "$out" "$dump"

# On relit l'en-tete pour s'assurer que le fichier est bien une archive age et
# non un dump laisse en clair par une erreur de redirection.
head -c 20 "$out" | grep -q "age-encryption" || {
  echo "ECHEC : le fichier produit n'est pas une archive age." >&2
  rm -f "$out"; exit 1
}

echo
echo "Sauvegarde : $out"
echo "Taille     : $(numfmt --to=iec "$(stat -c %s "$out")" 2>/dev/null || stat -c %s "$out")"
echo "Restaurer  : age -d -i <cle-privee> $out | pg_restore --no-owner -d <url>"
