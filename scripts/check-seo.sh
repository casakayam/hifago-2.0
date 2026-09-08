#!/usr/bin/env bash
# Garde-fou automatique — données structurées et référencement (cf. docs/specs/26-…, et la
# checklist SEO de .claude/skills/hifago-review/SKILL.md §3).
#
# Deux vérifications SEULEMENT, choisies pour ne produire aucun faux positif. Elles existent
# parce que les deux règles correspondantes sont invisibles à la relecture : l'une porte sur une
# absence, l'autre sur deux écritures visuellement identiques dont une seule fonctionne.
#
#   ./scripts/check-seo.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== Aucune donnée de notation inventée =="
# Il n'existe AUCUNE table d'avis dans ce schéma (vérifié par recherche exhaustive sur
# supabase/migrations/ et packages/supabase/src/database.types.ts). Émettre une note non
# corroborée par du contenu visible est la faute qui déclenche une action manuelle Google, longue
# à lever. Le jour où une table d'avis existera, cette vérification devra être RETIRÉE
# sciemment — pas contournée.
# Les COMMENTAIRES qui expliquent pourquoi on n'émet pas ces propriétés sont écartés : sans ce
# filtre, documenter la règle la ferait échouer.
hits="$(grep -rnE 'aggregateRating|ratingValue|reviewCount' apps/*/app apps/*/components apps/*/lib packages/*/src 2>/dev/null \
  | grep -v '\.test\.' \
  | grep -vE ':[0-9]+: *(//|\*|/\*)' || true)"
if [ -n "$hits" ]; then
  echo "$hits"
  echo "✗ Donnée de notation détectée alors qu'aucune table d'avis n'existe."
  fail=1
else
  echo "✓ Aucune donnée de notation émise."
fi

echo
echo "== Échappement du JSON-LD =="
# ⚠️ La règle que ce bloc protège s'est enfreinte TROIS FOIS pendant l'écriture du lot, dont deux
# dans les textes censés l'expliquer : `.replace(/</g, "<")` et `.replace(/</g, "<")` sont
# visuellement presque identiques, et la première ne fait strictement rien. Le contenu concerné
# est saisi par des PARTENAIRES : un `</script>` dans une description casserait la page.
#
# On cherche la séquence littérale barre-oblique-u003c. Une première version de ce script
# cherchait `<` — un motif que tout fichier .tsx contient, donc un contrôle qui ne pouvait jamais
# échouer. C'est exactement le piège CLAUDE.md §11 point 20 : une règle que rien ne vérifie.
while IFS= read -r f; do
  # Soit le fichier échappe lui-même, soit il délègue à serializeJsonLd (qui, lui, est couvert
  # par cette même vérification et par son test unitaire).
  if ! grep -q 'u003c' "$f" && ! grep -q 'serializeJsonLd' "$f"; then
    echo "✗ $f — insère du JSON-LD sans échappement de '<' (passer par serializeJsonLd)."
    fail=1
  fi
done < <(grep -rl 'application/ld+json' apps/*/app apps/*/components apps/*/lib 2>/dev/null | grep -v '\.test\.' || true)

# ⚠️ La boucle ci-dessus ne suffit PAS à elle seule, et l'avoir cru était le quatrième
# déclenchement du même piège : elle accepte un fichier qui délègue à serializeJsonLd, sans jamais
# regarder si serializeJsonLd échappe encore. Vérifié par MUTATION : retirer le .replace() du
# module la laissait passer au vert. Le module est donc contrôlé explicitement ici — et c'est le
# test unitaire lib/seo/jsonld/serialize.test.ts qui reste le garde-fou de FOND, parce qu'il
# vérifie le comportement (une description contenant </script> ressort neutralisée) plutôt que la
# présence d'un motif dans le source.
SERIALIZER="apps/web/lib/seo/jsonld/serialize.ts"
if [ -f "$SERIALIZER" ]; then
  if ! grep -qE 'replace\(/</g' "$SERIALIZER" || ! grep -q 'u003c' "$SERIALIZER"; then
    echo "✗ $SERIALIZER — n'échappe plus '<' en séquence \\u003c."
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ Tout insert de JSON-LD passe par un échappement explicite, et le sérialiseur échappe."
fi

echo
echo "== Zones non publiques : (tunnel), (cuenta), (auth) jamais indexables =="
# Spec 27 §0 invariant 6. Panier, paiement, compte et écrans d'authentification n'ont aucun contenu
# indexable, et une confirmation de commande porte des données personnelles.
#
# ⚠️ Le contrôle porte sur la COQUILLE DE ZONE, pas sur chaque page — et ce n'est pas un
# raccourci : les métadonnées Next se FUSIONNENT du layout vers la page, champ par champ. Vérifié
# en réel le 2026-09-07 sur le serveur de dev, dans les deux sens : en retirant le `robots` de
# `(tunnel)/pago/page.tsx`, la page sert TOUJOURS `noindex, follow` (hérité du layout) ; en lui
# faisant déclarer `index: true`, elle sert `index` et annule sa zone. Exiger un `robots` sur
# chaque page aurait donc crié à tort sur `(cuenta)/cuenta/reservas/page.tsx`, qui n'en a pas et
# n'en a pas besoin — et un contrôle qui crie à tort est un contrôle qu'on désactive.
#
# D'où les deux moitiés ci-dessous : la coquille l'impose, aucun fichier de la zone ne l'annule.
for zone in '(tunnel)' '(cuenta)' '(auth)'; do
  layout="apps/web/app/[locale]/$zone/layout.tsx"
  if [ ! -f "$layout" ]; then
    echo "✗ $layout — la zone existe sans coquille, donc sans robots."
    fail=1
    continue
  fi
  if ! grep -qE 'robots' "$layout" || ! grep -qE 'index:\s*false' "$layout"; then
    echo "✗ $layout — la coquille de zone doit exporter robots: { index: false }."
    fail=1
  fi
done

# Une page de ces zones qui REDÉCLARE robots en index:true écrase l'héritage sans bruit.
annulations="$(grep -rnE 'index:\s*true' "apps/web/app/[locale]/(tunnel)" "apps/web/app/[locale]/(cuenta)" "apps/web/app/[locale]/(auth)" 2>/dev/null || true)"
if [ -n "$annulations" ]; then
  echo "$annulations" | sed 's/^/    /'
  echo "✗ Une route de zone non publique se redéclare indexable — elle annule le noindex de sa coquille."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ Les trois zones non publiques sont noindex, et aucune route ne l'annule."
fi

exit $fail
