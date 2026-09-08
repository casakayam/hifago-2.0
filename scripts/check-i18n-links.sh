#!/usr/bin/env bash
# Garde-fou automatique — toute navigation interne de la vitrine passe par `@/i18n/navigation`
# (spec 27 §0 invariant 4 ; .claude/rules/apps.md).
#
# POURQUOI. `localePrefix: "always"` : aucune URL de ce site n'existe sans son préfixe de langue.
# Un `<a href="/productos/x">`, un `next/link` nu ou un `router.push("/pago")` produisent un chemin
# SANS préfixe. Ça ne casse pas visiblement — le proxy next-intl rattrape par une redirection — et
# c'est bien le problème : la langue du visiteur est alors redevinée depuis un cookie au lieu
# d'être celle de la page qu'il lisait, au prix d'un aller-retour réseau. Un anglophone se retrouve
# en espagnol sans qu'aucune erreur ne soit levée.
#
#   ./scripts/check-i18n-links.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
fail=0

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

fichiers() {
  find apps/web \
    \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print 2>/dev/null | sort
}

echo "== next/link importé au lieu du Link de @/i18n/navigation =="
while IFS= read -r f; do
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE 'from "next/link"|require\("next/link"\)' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" 'import { Link } from "@/i18n/navigation"'
done < <(fichiers)

echo
echo "== Lien interne écrit en <a href=\"/…\"> =="
# ⚠️ Seul un chemin LITTÉRAL est refusé. `<a href={…}>` n'est pas visé, et c'est délibéré : les
# doublures de test qui remplacent le Link de next-intl rendent exactement ça (c'est leur objet),
# et un `href` dynamique porte aussi bien une URL externe (`partner.website`) qu'un chemin interne.
# Un contrôle qui se battrait contre les deux serait désactivé au premier lien externe légitime.
# Les liens externes réels du dépôt passent par `LinkButton external`, qui pose `rel` lui-même.
while IFS= read -r f; do
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE '<a[^>]*href="/' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" 'Utiliser <Link href="…"> de @/i18n/navigation'
done < <(fichiers)

echo
echo "== Navigation programmée prise dans next/navigation =="
# `notFound()` n'est PAS visé : il n'a pas d'équivalent localisé et ne construit aucune URL.
# Ne sont refusés que les quatre exports qui, eux, fabriquent un chemin.
while IFS= read -r f; do
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" \
    | grep -nE 'import\s*\{[^}]*\b(useRouter|redirect|permanentRedirect|usePathname)\b[^}]*\}\s*from\s*"next/navigation"' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    'Ces exports existent en version localisée dans @/i18n/navigation — next/navigation ne pose pas le préfixe de langue.'
done < <(fichiers)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Toute navigation interne passe par @/i18n/navigation."
else
  echo "✗ Voir ci-dessus."
fi
exit $fail
