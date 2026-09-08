#!/usr/bin/env bash
# Garde-fou automatique — cohérence du design system (cf. .claude/skills/hifago-review/SKILL.md §4).
# Reprend tel quel deux des greps déjà écrits en prose dans ce skill, pour un contrôle reproductible
# en CI plutôt que dépendre uniquement d'une relecture manuelle.
#
#   ./scripts/check-design-system.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une rupture est trouvée.

set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== Import direct de @heroui/react hors de packages/ui/ =="
# Déjà couvert par le lint no-restricted-imports (eslint.config.mjs) — redondant mais gratuit à
# garder en filet, notamment pour du code généré ou un fichier hors périmètre du lint (ex. script).
hits="$(grep -rn 'from "@heroui/react"' apps/*/app apps/*/components apps/*/lib 2>/dev/null | grep -v '/packages/ui/' || true)"
if [ -n "$hits" ]; then
  echo "$hits"
  echo "✗ Import direct de @heroui/react détecté hors de packages/ui/ — passer par @hifago/ui."
  fail=1
else
  echo "✓ Aucun import direct de @heroui/react hors de packages/ui/."
fi

echo
echo "== Table.Body/Table.Content avec items=/renderEmptyState= sans \"use client\" en tête =="
# La contrainte réelle (hifago/CLAUDE.md §2 point 3) ne porte QUE sur l'idiome children-en-fonction
# (items=/renderEmptyState=) — un Table.Body/Table.Content à enfants JSX statiques (.map() classique)
# est un idiome valide en Server Component (idiome (b)) et ne doit pas être flaggé. Grep sur
# Table.Body/Table.Content seul, sans ce filtre, produit des faux positifs.
while IFS= read -r f; do
  if grep -q 'Table\.\(Body\|Content\)' "$f" 2>/dev/null && grep -qE '\b(items|renderEmptyState)=' "$f" 2>/dev/null; then
    first_line="$(head -n1 "$f")"
    if [ "$first_line" != '"use client";' ] && [ "$first_line" != "'use client';" ]; then
      echo "✗ $f — Table.Body/Table.Content avec items=/renderEmptyState= sans \"use client\" en ligne 1 (non sérialisable à travers la frontière RSC, cf. hifago/CLAUDE.md §2 point 3)."
      fail=1
    fi
  fi
done < <(find apps -type f -path '*/app/*page.tsx')
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucun Table.Body/Table.Content non sérialisable détecté."
fi

echo
echo "== Aucun barrel index.ts dans apps/web/components =="
# La convention « pas de barrel » (apps/web/components/README.md, CLAUDE.md §2.7) n'existait que
# sur le papier. Or c'est le fichier que le premier agent pressé créera par réflexe, et une fois
# qu'il est là les suivants l'utilisent : on ne revient plus en arrière. Il est interdit parce que
# plusieurs agents créent des composants EN PARALLÈLE dans le même répertoire de travail — un
# barrel serait le fichier que tous éditent à chaque ajout, donc celui où ils s'écrasent.
#
# ⚠️ Scopé à apps/web/components : `packages/ui/src/index.ts` EST un barrel délibéré, et une règle
# globale le condamnerait à tort.
hits="$(find apps/web/components \( -name 'index.ts' -o -name 'index.tsx' \) 2>/dev/null || true)"
if [ -n "$hits" ]; then
  echo "$hits"
  echo "✗ Barrel détecté dans apps/web/components — importer chaque composant par son chemin (cf. apps/web/components/README.md)."
  fail=1
else
  echo "✓ Aucun barrel dans apps/web/components."
fi

echo
echo "== Composant d'apps/web important @hifago/ui sans \"use client\" en tête =="
# ⚠️ CLAUDE.md §11.16 : importer N'IMPORTE QUEL nom depuis le barrel @hifago/ui tire l'ensemble de
# son graphe de modules, et fait planter `next build` (« Collecting page data ») dès que ce graphe
# atteint un Server Component. La règle documentée dit donc : tout composant qui importe le barrel
# porte "use client" en ligne 1, et devient le point d'entrée HeroUI de ses appelants.
#
# ⚠️ Cette règle n'était vérifiée par RIEN jusqu'au 2026-09-02. Or §11.16 dit lui-même que la
# violation est invisible au typecheck ET au lint : elle ne se voit qu'au build, sur la route qui
# atteint le composant — donc en pratique sur un déploiement. C'est le motif exact du §11 point 20
# (« une règle documentée que rien ne vérifie n'est pas une règle »), appliqué à la raison d'être
# n°1 de la surcouche de composants.
#
# Stories et tests sont exclus : ils n'entrent jamais dans le graphe de modules de `next build`.
while IFS= read -r f; do
  case "$f" in *.stories.tsx|*.test.tsx) continue ;; esac
  if grep -q 'from "@hifago/ui"' "$f" 2>/dev/null; then
    first_line="$(head -n1 "$f")"
    if [ "$first_line" != '"use client";' ] && [ "$first_line" != "'use client';" ]; then
      echo "✗ $f — importe @hifago/ui sans \"use client\" en ligne 1 (le barrel fait planter next build depuis un Server Component, cf. CLAUDE.md §11.16)."
      fail=1
    fi
  fi
done < <(find apps/web/components -type f -name '*.tsx' 2>/dev/null)
if [ "$fail" -eq 0 ]; then
  echo "✓ Tout composant d'apps/web important @hifago/ui porte \"use client\"."
fi

echo
echo "== Fichier de route d'apps/web important @hifago/ui =="
# Spec 27 §0 invariant 1. Pour un COMPOSANT, la règle du bloc précédent suffit : il peut importer
# le barrel s'il porte "use client". Pour un `page.tsx`/`layout.tsx`, elle ne suffit pas — la
# réponse « ajouter "use client" » y serait pire que le mal : une route cliente perd le rendu
# serveur, les métadonnées et l'accès aux données. Une route n'importe donc JAMAIS le barrel ; elle
# monte un composant qui, lui, le fait.
#
# ⚠️ Les COMMENTAIRES sont retirés avant la recherche, et ce n'est pas une précaution théorique :
# mesuré le 2026-09-07, une recherche naïve remonte QUATRE fichiers de route — `(vitrine)/page.tsx`,
# `(vitrine)/layout.tsx`, `(vitrine)/establecimientos/[slug]/page.tsx` et `not-found.tsx` — dont
# aucun n'importe quoi que ce soit : tous les quatre CITENT la règle pour expliquer pourquoi ils ne
# l'enfreignent pas. Un contrôle qui punit les fichiers les plus soigneux est un contrôle qu'on
# désactive (spec 27 §8).
SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
while IFS= read -r f; do
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE 'from "@hifago/ui"' || true)"
  [ -z "$hits" ] && continue
  echo "✗ $f"
  echo "$hits" | sed 's/^/    /'
  echo "    → Une route ne monte pas HeroUI : passer par un composant d'apps/web/components."
  fail=1
done < <(find apps/web/app \
           \( -name node_modules -o -name .next \) -prune -o \
           -type f \( -name 'page.tsx' -o -name 'layout.tsx' -o -name 'not-found.tsx' \
                      -o -name 'error.tsx' -o -name 'loading.tsx' -o -name 'template.tsx' \) -print 2>/dev/null | sort)
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucun fichier de route d'apps/web n'importe @hifago/ui."
fi

exit $fail
