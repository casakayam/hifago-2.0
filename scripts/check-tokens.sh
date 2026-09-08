#!/usr/bin/env bash
# Garde-fou automatique — aucune couleur en dur dans la vitrine (spec 27 §3 et §8).
#
# POURQUOI. L'identité visuelle de la vitrine est repoussée : on construit neutre, on habille
# après. Ce choix ne tient QUE si aucun écran n'écrit une couleur — sinon l'habillage d'après ne
# rattrape rien et il faut repeindre vingt écrans à la main. D'où un contrôle, pas une consigne.
#
# La couleur passe par les jetons sémantiques du thème (`bg-surface`, `text-foreground`,
# `border-default-200`, `var(--…)`), jamais par une valeur ni par une classe de palette Tailwind.
#
#   ./scripts/check-tokens.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
fail=0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Exemptions — nommées, avec leur raison. Jamais un motif large.
# ─────────────────────────────────────────────────────────────────────────────────────────────
est_exempte() {
  case "$1" in
    # Les DRAPEAUX SVG (colombien, britannique) de LanguageSwitcher : les huit seules valeurs
    # hexadécimales du dépôt. Un drapeau n'a pas de jeton sémantique — sa couleur EST sa
    # définition, et la repeindre au thème le rendrait faux. Exempté PAR FICHIER plutôt que par
    # attribut `fill=`/`stroke=` : exempter l'attribut laisserait passer n'importe quelle icône de
    # marque codée en dur, alors que nommer le fichier force la conversation au prochain drapeau.
    apps/web/components/organisms/LanguageSwitcher.tsx) return 0 ;;

    # Sonde de CONTRASTE d'une story : `rgba(0, 0, 0, 0)` est la valeur que rend
    # `getComputedStyle` pour un fond transparent (une sentinelle du moteur, pas une couleur
    # choisie), et `rgb(255,255,255)` le repli blanc sur lequel empiler les fonds `soft`
    # semi-transparents pour calculer un ratio réel. Aucune de ces deux valeurs n'est peinte.
    apps/web/components/atoms/Button.stories.tsx) return 0 ;;
  esac
  return 1
}

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

echo "== Couleurs écrites en dur (hex, oklch, rgb, hsl) =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE '#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\b|\b(oklch|rgba?|hsla?)\(' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Passer par un jeton sémantique du thème (bg-surface, text-foreground, var(--…))."
done < <(find apps/web \
           \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
           -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print 2>/dev/null | sort)

echo
echo "== Classes de palette Tailwind (bg-blue-500 et compagnie) =="
# La palette brute de Tailwind court-circuite le thème aussi sûrement qu'un hex : `bg-blue-500`
# vaut la même couleur sous `data-theme="vitrine"` et sous `data-theme="admin"`. Les jetons
# sémantiques (`default`, `surface`, `foreground`, `focus`, `danger`…) ne sont PAS dans cette
# liste — c'est exactement ce qu'on veut voir écrit.
PALETTE='slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
UTILITAIRES='bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|divide|accent|caret|decoration|placeholder'
while IFS= read -r f; do
  est_exempte "$f" && continue
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE "\b($UTILITAIRES)-($PALETTE)-[0-9]{2,3}\b" || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Utiliser un jeton sémantique (default, surface, foreground, focus, danger…), pas la palette brute."
done < <(find apps/web \
           \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
           -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print 2>/dev/null | sort)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune couleur en dur : tout passe par les jetons du thème."
else
  echo "✗ Voir ci-dessus. Si une exception est réellement légitime, l'AJOUTER NOMMÉMENT dans est_exempte(), avec sa raison."
fi
exit $fail
