import type { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/messages";

type RouterVitrine = ReturnType<typeof useRouter>;

/**
 * Naviguer vers `chemin` en CONSERVANT la recherche en cours (bug Jérôme du 2026-09-16 : cliquer
 * le logo, ou changer de langue, effaçait les filtres actifs).
 *
 * ⚠️ Le raisonnement délicat vit ICI, une seule fois — il était recopié dans les deux composants
 * de coquille le jour même, et le prochain lien qui en aura besoin en aurait fait un troisième :
 *  - le `href` du `<Link>` reste STATIQUE : c'est lui qui est dans le HTML servi, donc la
 *    dégradation sans JS et la découverte par un crawler ;
 *  - la query string est lue en DIRECT sur `window.location.search` AU CLIC, jamais pendant le
 *    rendu (aucun risque d'hydratation) ni via `useSearchParams()` — ce dernier forcerait ces
 *    composants, montés sur TOUTE page vitrine, en client-only sans `Suspense` sur une route
 *    statique (ex. une fiche produit, qui n'a ni `searchParams` ni `generateStaticParams`).
 *
 * ⚠️ Connu et assumé : l'appelant doit `preventDefault()`, ce qui neutralise ctrl+clic / clic
 * milieu sur ces liens. Contrepartie du `href` statique ci-dessus, pas un oubli.
 */
export function empujarConservandoQuery(
  router: RouterVitrine,
  chemin: string,
  opciones?: { locale?: Locale }
): void {
  const destino = `${chemin}${window.location.search}`;
  // ⚠️ `opciones` n'est JAMAIS passé quand il est absent : un `undefined` explicite reste un
  // argument pour `toHaveBeenCalledWith`, et l'appel cesserait d'être celui qu'attendent les tests
  // du header — et, surtout, ne serait plus identique à ce que faisaient les deux appelants.
  if (opciones) router.push(destino, opciones);
  else router.push(destino);
}
