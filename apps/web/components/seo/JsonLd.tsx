import { serializeJsonLd } from "@/lib/seo/jsonld/serialize";

/**
 * Insère un nœud JSON-LD dans le HTML.
 *
 * Balise `<script>` NATIVE, jamais `next/script` : celui-ci est optimisé pour charger et exécuter
 * du JavaScript, alors qu'un JSON-LD est une donnée inerte.
 *
 * ⚠️ À rendre depuis un Server Component (`page.tsx`), pas depuis la vue cliente — pour une raison
 * de DONNÉES et non de sérialisation : les vues clientes de ce projet reçoivent des valeurs déjà
 * mises en forme pour l'affichage (le prix arrive en chaîne formatée `formatCop(...)`, le `slug`
 * et le `type` ne leur sont même pas passés), inutilisables pour construire une offre. Le Server
 * Component, lui, a les valeurs brutes.
 *
 * Ce composant n'importe rien de `@hifago/ui` : il est hors de portée du piège CLAUDE.md §11.16.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
  );
}
