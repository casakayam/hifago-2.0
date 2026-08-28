#!/usr/bin/env bash
# Garde-fou automatique — toutes les dates civiles sont en heure de Guatapé (America/Bogota).
#
#   ./scripts/check-timezone.sh   (depuis hifago/)   — sort en erreur (exit 1) si une faute est trouvée.
#
# POURQUOI CE SCRIPT EXISTE, en plus de la règle eslint. Le 2026-08-28, dix sites calculaient
# « aujourd'hui » en UTC ou dans le fuseau du navigateur, et la chaîne "America/Bogota" n'existait
# NULLE PART dans le code — seulement dans trois commentaires. La règle était documentée depuis des
# mois et n'avait jamais été outillée : c'est précisément pour ça qu'il y avait dix sites.
#
# La règle eslint (eslint.rules.mjs) couvre apps/web et apps/admin. Elle ne voit RIEN d'autre :
# packages/ n'a pas de configuration eslint, supabase/functions/ tourne sous Deno hors du monorepo
# npm, tests/ n'est pas un workspace, et le SQL n'est pas du JavaScript. Or le dixième site du lot
# était packages/e2e-support/src/date.ts — donc exactement dans l'angle mort. Ce script couvre le
# reste, et repasse sur les apps en filet (même parti pris que check-design-system.sh).
#
# HORS PÉRIMÈTRE, volontairement :
#   - scripts/ (outillage de build, pas du comportement produit) ;
#   - le formatage d'une date DÉJÀ RÉSOLUE (`day.date.toLocaleDateString(…)` sur un jour de grille
#     de calendrier, `Intl.DateTimeFormat` appliqué à un `new Date(\`${iso}T00:00:00\`)`) : il n'y a
#     là aucune projection d'instant, donc aucun fuseau à choisir. C'est pourquoi le motif
#     `new Date(…).toLocale…` ci-dessous vise le RECEVEUR `new Date(…)` et rien d'autre — c'est le
#     seul critère textuel qui sépare « je projette un instant » de « je mets en forme un jour ».
#   - `getFullYear()/getMonth()/getDate()` isolés : trop ambigus pour un grep. Dette connue, à
#     reprendre avec un lint AST si le besoin s'en fait sentir.
#
# Les commentaires sont retirés avant analyse (`//` en JS/TS, `--` en SQL) : ce fichier-ci, et
# beaucoup d'autres, CITENT les expressions interdites pour les expliquer. Limite connue et
# assumée : un `--` à l'intérieur d'une chaîne SQL masquerait la fin de sa ligne (faux négatif
# possible, jamais un faux positif).

set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# ------------------------------------------------------------------------------------------------
# EXCEPTIONS NOMMÉES, avec leur raison.
#
# ⚠️ Ajouter un chemin ici n'est PAS une formalité : c'est déclarer qu'un calcul de date échappe
# légitimement à la règle. Le faire seulement après avoir lu le code — et si la raison est
# « l'aller-retour est ancré UTC des deux côtés », se demander d'abord pourquoi il ne passe pas
# simplement par addDaysIso().
# ------------------------------------------------------------------------------------------------
est_exempte() {
  case "$1" in
    # L'échappatoire elle-même. C'est ici, et nulle part ailleurs, que ces expressions vivent.
    packages/domain/src/time/bogotaDates.ts) return 0 ;;
    # Leurs tests : ils REPRODUISENT le geste interdit comme témoin, pour prouver l'écart.
    packages/domain/src/time/bogotaDates.test.ts) return 0 ;;
    apps/web/app/\[locale\]/products/\[slug\]/LodgingReservationForm.timezone.test.tsx) return 0 ;;
    supabase/tests/database/clients_stage_timezone.test.sql) return 0 ;;

    # Arithmétique de date ancrée UTC des DEUX côtés (parse `${iso}T00:00:00Z`, formate en UTC) :
    # auto-cohérente, donc indépendante de tout fuseau. Ce n'est pas une faute — mais c'est une
    # SECONDE implémentation d'addDaysIso(). À faire converger quand le lot connecteur PMS (session
    # parallèle du 2026-08-28, qui tenait ces fichiers ouverts) aura livré.
    packages/domain/src/pms/getNightAvailabilityWindow.ts) return 0 ;;
    packages/domain/src/pms/getNightAvailabilityWindow.test.ts) return 0 ;;
    packages/domain/src/pms/buildEvenRatesPerDay.ts) return 0 ;;
    packages/e2e-support/src/pmsFixtureServer.ts) return 0 ;;

    # Comparaison SYMÉTRIQUE : les deux membres subissent la même transformation, donc l'égalité ne
    # dépend d'aucun fuseau. Aucune de ces deux dates n'est jamais affichée.
    tests/concurrency/create_order_date_range.concurrency.mjs) return 0 ;;

    # ⚠️ VRAIE DETTE, pas un cas légitime. Ce job nocturne prend « aujourd'hui » dans le fuseau de
    # Deno Deploy (UTC) : à partir de 19 h heure de Guatapé, il sonde déjà le lendemain. Sans
    # conséquence client (c'est une vérification de contrat, pas un affichage), et le fichier
    # appartenait à la session parallèle le 2026-08-28. À reprendre avec todayInBogota().
    supabase/functions/pms-nightly-contract-check/index.ts) return 0 ;;

    # Migration HISTORIQUE, déjà appliquée partout : une migration appliquée ne se réécrit pas. Son
    # défaut est corrigé par 20260828150000_dates_civiles_en_heure_de_bogota.sql, qui remplace la
    # fonction. Cette entrée doit rester : le fichier, lui, ne changera plus jamais.
    supabase/migrations/20260819210000_clients_admin_rpc.sql) return 0 ;;
  esac
  return 1
}

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

echo "== Dates civiles calculées hors du fuseau de Guatapé (TS/JS) =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  hits="$(sed 's://.*::' "$f" | grep -nE 'toISOString\(\)\.(slice|substring|substr|split)|new Date\(\)|new Date\(Date\.now\(\)\)|new Date\([^)]*\)\.toLocale' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Utiliser packages/domain/src/time/ : todayInBogota(), startOfTodayInBogota(), addDaysIso(), nowIsoInstant()."
done < <(find apps packages supabase/functions tests \
           \( -name node_modules -o -name .next -o -name dist -o -name out -o -name build \) -prune -o \
           -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.js' -o -name '*.jsx' -o -name '*.mts' -o -name '*.cts' \) -print 2>/dev/null | sort)

echo
echo "== current_date nu dans le SQL =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  # -i, et les variantes strictement équivalentes : une fois `current_date` interdit, `now()::date`
  # est la reformulation la plus naturelle — et elle a exactement le même défaut (elle lit le
  # TimeZone de la SESSION). `current_timestamp at time zone '…'` n'est PAS visé : c'est le
  # correctif. Zéro occurrence de ces variantes dans le dépôt au 2026-08-28 : les ajouter est
  # gratuit aujourd'hui et ferme la porte pour demain.
  hits="$(sed 's:--.*::' "$f" | grep -in \
    -e 'current_date' \
    -e 'now()[[:space:]]*::[[:space:]]*date' \
    -e 'current_timestamp[[:space:]]*::[[:space:]]*date' \
    -e 'localtimestamp' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Utiliser public.today_in_bogota() (migration 20260828150000) : current_date rend la date du fuseau de la SESSION, UTC sur Supabase."
done < <(find supabase \( -name node_modules -o -name .branches -o -name .temp \) -prune -o \
           -type f -name '*.sql' -print 2>/dev/null | sort -u)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Toutes les dates civiles passent par le fuseau de Guatapé."
else
  echo "✗ Voir ci-dessus. Si une exception est réellement légitime, l'AJOUTER NOMMÉMENT dans est_exempte(), avec sa raison."
fi
exit $fail
