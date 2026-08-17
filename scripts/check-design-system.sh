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

exit $fail
