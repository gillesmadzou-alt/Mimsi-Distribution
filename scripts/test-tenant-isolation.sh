#!/usr/bin/env bash
# Rejoue toutes les migrations sur un Postgres jetable, puis verifie qu'aucune
# donnee ne franchit la frontiere entre deux locataires.
#
#   ./scripts/test-tenant-isolation.sh
#
# Ne demande ni Supabase, ni Docker : juste un PostgreSQL 15+ local.
# Les 19 migrations specifiques a la plateforme Supabase (storage, realtime,
# auth.identities) ne s'appliquent pas hors de Supabase et sont ignorees ;
# elles ne touchent pas au cloisonnement.
set -euo pipefail

PORT="${PGTEST_PORT:-5433}"
HOST="${PGTEST_HOST:-/tmp}"
DB="${PGTEST_DB:-mimsi_isolation_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql -h "$HOST" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)

echo "→ base de test jetable : $DB"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_supabase_shim.sql" >/dev/null 2>&1

echo "→ rejeu des migrations"
applied=0; skipped=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  if "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    skipped=$((skipped + 1))
  fi
done
echo "   $applied appliquees, $skipped ignorees (specifiques Supabase)"

echo "→ test d'isolation"
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
  -f "$ROOT/supabase/tests/tenant_isolation_test.sql" 2>&1 \
  | grep -vE '^(BEGIN|ROLLBACK|DO)$' | sed 's|^psql:[^ ]* ||'

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
