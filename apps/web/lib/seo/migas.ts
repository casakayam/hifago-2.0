import type { MigaItem } from "@/components/molecules/Migas";
import type { BreadcrumbItem } from "@/lib/seo/jsonld/breadcrumb";

/**
 * Le fil d'Ariane VISIBLE et son JSON-LD, depuis UNE seule liste.
 *
 * ⚠️ C'est la seule façon de tenir la règle SEO 6 (« un JSON-LD décrit exactement ce que la page
 * montre »). Deux listes écrites côte à côte se ressemblent le jour où on les écrit et divergent
 * au premier ajout d'un niveau — sans qu'aucun test ne rougisse, puisque chacune vérifierait la
 * sienne.
 *
 * Le mapping était recopié dans `ListadoTipo.tsx` ; la spec 30 en aurait fait un troisième et un
 * quatrième exemplaire. Extrait plutôt que recopié une fois de plus.
 *
 * Deux différences entre les deux formes, et elles sont la raison d'être de cette fonction :
 *  - le fil visible porte des chemins SANS préfixe de langue (`Migas` le pose lui-même) ; le
 *    JSON-LD en a besoin, parce qu'il déclare des URL absolues ;
 *  - le DERNIER élément n'a pas de `href` (la page courante n'est pas un lien vers elle-même),
 *    mais le JSON-LD doit quand même lui donner un chemin : sa route canonique.
 */
export function migasParaJsonLd(
  migas: MigaItem[],
  locale: string,
  rutaCanonica: string
): BreadcrumbItem[] {
  return migas.map((miga) => ({
    name: miga.nombre,
    path: `/${locale}${miga.href ?? rutaCanonica}`,
  }));
}

/**
 * La copie AFFICHÉE du fil d'Ariane, chaque lien portant les critères de recherche en cours.
 *
 * ⚠️ Jamais appliqué à `migas` lui-même, qui reste la source UNIQUE du JSON-LD `BreadcrumbList` :
 * un `BreadcrumbList` doit rester une hiérarchie canonique, jamais porter un état de filtre
 * éphémère (Google). C'est la SEULE divergence tolérée entre le fil visible et son JSON-LD — la
 * structure (chemin, libellé, ordre), elle, ne doit jamais diverger, cf. `migasParaJsonLd`.
 *
 * Bug Jérôme du 2026-09-16 : cliquer « Inicio » (ou la section parente) depuis une page filtrée
 * effaçait la recherche en cours. Le `map` a été écrit deux fois le jour même (`ListadoTipo`,
 * `IndiceCategoriasConOfertas`) — exactement la copie que l'extraction du 2026-09-08 avait
 * supprimée de `ListadoTipo`. Il vit ici, une fois. Un `sufijo` vide rend des `href` identiques :
 * aucun embranchement à écrire au point d'appel.
 */
export function migasConCriterios(migas: MigaItem[], sufijo: string): MigaItem[] {
  return migas.map((miga) => (miga.href ? { ...miga, href: `${miga.href}${sufijo}` } : miga));
}
