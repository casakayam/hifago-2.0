#!/usr/bin/env bash
# Garde-fou automatique — aucune requête Supabase dans un fichier de route de la vitrine
# (spec 27 §0 invariant 2, §7).
#
# POURQUOI. Une requête écrite dans un `page.tsx` est invisible au reste du projet : elle
# redéfinit en silence l'ordre du catalogue, le prédicat de visibilité et la forme des données,
# et le prochain écran qui a besoin des mêmes offres la réécrit autrement. La vitrine a UNE couche
# d'accès, `apps/web/lib/catalog/`, et c'est le seul endroit d'où part une requête. C'est aussi
# elle qui porte `import "server-only"` et le client anonyme sans cookies : contourner la couche,
# c'est aussi contourner ces deux choix-là.
#
#   ./scripts/check-data-layer.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
fail=0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Les cinq écrans hérités, que les specs 28 et suivantes REMPLACENT (lot B3).
#
# ⚠️ Cette liste est de la DETTE VISIBLE, pas une permission : elle n'existe que pour rendre le
# contrôle bloquant AUJOURD'HUI sur tout écran neuf, au lieu d'attendre que les cinq soient
# réécrits pour l'activer — c'est-à-dire de ne jamais l'activer. Elle doit RÉTRÉCIR à chaque lot,
# et le jour où elle est vide, ce bloc disparaît. Une ligne ajoutée ici est une régression.
# ─────────────────────────────────────────────────────────────────────────────────────────────
est_ecran_herite() {
  case "$1" in
    "apps/web/app/[locale]/(vitrine)/establecimientos/[slug]/page.tsx") return 0 ;;
    "apps/web/app/[locale]/(vitrine)/productos/[slug]/page.tsx") return 0 ;;
    "apps/web/app/[locale]/(cuenta)/cuenta/reservas/page.tsx") return 0 ;;
    "apps/web/app/[locale]/(tunnel)/pago/page.tsx") return 0 ;;
  esac
  return 1
}

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

fichiers_de_route() {
  find apps/web/app \
    \( -name node_modules -o -name .next \) -prune -o \
    -type f \( -name 'page.tsx' -o -name 'layout.tsx' -o -name 'not-found.tsx' \
               -o -name 'error.tsx' -o -name 'loading.tsx' -o -name 'template.tsx' \) -print 2>/dev/null | sort
}

echo "== Requête Supabase dans un fichier de route =="
while IFS= read -r f; do
  est_ecran_herite "$f" && continue
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE '\.from\(' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Déplacer la lecture dans apps/web/lib/catalog/ et n'appeler qu'elle depuis la route."
done < <(fichiers_de_route)

echo
echo "== Client Supabase construit dans un fichier de route =="
# ⚠️ `(cuenta)/layout.tsx` est exempté, et ce n'est PAS un oubli : la spec 27 §5 y place la seule
# garde d'accès du site, qui doit résoudre la session (`auth.getUser()`) au plus près de ce
# qu'elle protège. Elle ne lit aucune donnée métier — le bloc `.from(` ci-dessus, lui, s'applique
# toujours à ce fichier. Le jour où une garde apparaît ailleurs, elle rejoint cette liste
# NOMMÉMENT, avec sa raison.
while IFS= read -r f; do
  est_ecran_herite "$f" && continue
  case "$f" in "apps/web/app/[locale]/(cuenta)/layout.tsx") continue ;; esac
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE '\bcreateClient\b|createPublicClient' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Une route ne construit pas de client Supabase : lib/catalog/ le fait, ou la garde de (cuenta)."
done < <(fichiers_de_route)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune route de la vitrine ne parle à Supabase en direct."
else
  echo "✗ Voir ci-dessus. La liste des écrans hérités doit RÉTRÉCIR, jamais grandir."
fi
exit $fail
