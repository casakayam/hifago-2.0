#!/usr/bin/env bash
# Reconstruit entièrement la base locale : migrations, puis comptes auth, puis données.
#
# Ces trois étapes existent séparément parce que le seed ne PEUT pas être automatique
# (cf. supabase/config.toml §[db.seed], `enabled = false`) : seed.sql insère des lignes dont la
# clé étrangère pointe vers auth.users, et ces utilisateurs ne peuvent être créés que par l'API
# Admin Auth — l'INSERT SQL direct dans auth.users est refusé sur Supabase Cloud. L'ordre n'est
# donc pas négociable, et le seul endroit où il est écrit une fois pour toutes, c'est ici.
#
# ATTENTION : `db reset` EFFACE la base locale, qui est partagée par toutes les sessions de
# travail ouvertes sur ce dépôt. Ne pas lancer ce script sans savoir si quelqu'un d'autre a des
# données en cours dessus (cf. CLAUDE.md §12).
#
# Usage : npm run db:setup
#         SUPABASE_BIN=supabase npm run db:setup   # pour une CLI déjà installée sur le PATH
set -euo pipefail

cd "$(dirname "$0")/.."

SUPABASE="${SUPABASE_BIN:-npx --yes supabase}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql introuvable (client PostgreSQL requis pour appliquer seed.sql)." >&2
  echo "macOS : brew install libpq && brew link --force libpq" >&2
  exit 1
fi

echo "==> 1/3 migrations (sans seed)"
$SUPABASE db reset --no-seed

# `status -o env` sort des lignes CLE="valeur" ; le grep écarte les avertissements de la CLI,
# qui ne sont pas des affectations et casseraient le eval.
eval "$($SUPABASE status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"

echo "==> 2/3 comptes auth (API Admin Auth)"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  node supabase/scripts/seed_auth_users.mjs

echo "==> 3/3 données synthétiques (seed.sql)"
psql "$DB_URL" -f supabase/seed.sql

echo "==> base locale prête"
