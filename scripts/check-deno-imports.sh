#!/usr/bin/env bash
# Garde-fou automatique — tout module atteignable depuis une Edge Function importe AVEC extension.
#
#   ./scripts/check-deno-imports.sh   (depuis hifago/)   — exit 1 si une faute est trouvée.
#
# POURQUOI CE SCRIPT EXISTE. Le 2026-09-17, une Edge Function neuve a importé
# `packages/domain/src/pms/getNightAvailabilityWindow.ts`, dont la première ligne importait
# `"../time/bogotaDates"` SANS extension. Deno résout ses imports par URL : le worker ne boote pas
# du tout (`BOOT_ERROR — Module not found … Maybe add a '.ts' extension`). Le défaut vivait là
# depuis des mois, invisible, parce qu'aucune Edge Function n'avait encore tiré ce module.
#
# ⚠️ ET LE JOB `functions` DE LA CI NE L'ATTRAPE PAS. `deno check --node-modules-dir=auto` résout à
# la TypeScript et passe au VERT sur un import sans extension ; seul un boot réel le révèle. La
# règle « une règle documentée que rien ne vérifie n'est pas une règle » (CLAUDE.md §11.20)
# s'applique donc littéralement — et `docs/dette-technique.md` avait déjà écrit que ce script
# fermerait le cas.
#
# PÉRIMÈTRE : le GRAPHE RÉEL, suivi depuis `supabase/functions/*/index.ts`, et rien d'autre. Ce
# n'est pas un détail de mise en œuvre, c'est ce qui rend le script utilisable : `packages/ui`,
# `packages/supabase`, `packages/e2e-support` et les barrels `index.ts` du domaine portent une
# centaine d'imports sans extension, tous parfaitement légitimes puisqu'ils sont bundlés par Next
# ou par Vitest, jamais chargés par Deno. Les balayer produirait 100 faux positifs et le script
# serait désactivé dans la semaine. Un module devient surveillé le jour où une Edge Function
# l'atteint — donc exactement quand ça compte.
#
# HORS PÉRIMÈTRE : `npm:`, `node:`, `jsr:`, `https:` et les bare specifiers (pas d'extension par
# définition).
set -uo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

# Normalise `a/b/../c` en `a/c` — `realpath` n'est pas portable et le fichier cible peut manquer
# (c'est précisément le défaut qu'on cherche).
normaliser() {
  local chemin="$1" sortie=()
  local IFS='/'
  for segment in $chemin; do
    case "$segment" in
      '' | '.') ;;
      '..') unset 'sortie[${#sortie[@]}-1]' ;;
      *) sortie+=("$segment") ;;
    esac
  done
  printf '%s' "${sortie[*]}"
}

fautes=()
vus=" "
file=()
while IFS= read -r entree; do file+=("$entree"); done < <(ls supabase/functions/*/index.ts 2>/dev/null)

while [ ${#file[@]} -gt 0 ]; do
  fichier="${file[0]}"
  file=("${file[@]:1}")
  case "$vus" in *" $fichier "*) continue ;; esac
  vus="$vus$fichier "
  [ -f "$fichier" ] || continue

  dossier="$(dirname "$fichier")"
  while IFS= read -r cible; do
    [ -n "$cible" ] || continue
    resolu="$(normaliser "$dossier/$cible")"
    case "$cible" in
      *.ts | *.tsx | *.mts | *.js | *.mjs | *.json)
        file+=("$resolu")
        ;;
      *)
        fautes+=("$fichier → \"$cible\"")
        ;;
    esac
  done < <(grep -oE '(from|import)[[:space:]]+"\.\.?/[^"]*"' "$fichier" 2>/dev/null \
             | sed -E 's/.*"(.*)"/\1/')
done

if [ ${#fautes[@]} -gt 0 ]; then
  echo "✗ Imports relatifs SANS extension, atteignables depuis une Edge Function."
  echo "  Deno ne les résout pas : le worker ne bootera pas (BOOT_ERROR)."
  echo
  printf '  %s\n' "${fautes[@]}"
  echo
  echo '  Ajouter l extension : "./x" devient "./x.ts".'
  echo '  `deno check` ne voit PAS ce defaut (il resout a la TypeScript) — cf. l en-tete du script.'
  exit 1
fi

echo "✓ Tous les modules atteignables depuis supabase/functions/ importent avec extension."
