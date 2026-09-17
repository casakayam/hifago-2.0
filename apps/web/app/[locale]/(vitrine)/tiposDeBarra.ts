import { getTranslations } from "next-intl/server";
import { ORDEN_SECCIONES, type TipoOferta } from "@/lib/catalog/tipos";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { Locale } from "@/messages";

// Les cinq onglets de type de `SelectorTipo`. Jusqu'au 2026-09-15, appelé par les cinq écrans qui
// montraient encore ce sélecteur (l'accueil, les quatre listings, l'index de catégories, les deux
// fiches) — depuis le retour de Jérôme qui réserve `SelectorTipo` à la home (`Migas` seul partout
// ailleurs, voir `page.tsx`), `page.tsx` (l'accueil) en est le SEUL appelant. Laissé en fonction
// séparée plutôt que réinlinée : elle compose deux sources de vérité déjà tranchées ailleurs (voir
// plus bas) et resterait la bonne extension le jour où un second écran remonterait ce sélecteur.
//
// ⚠️ Le label et la route sont dérivés de deux sources de vérité déjà tranchées ailleurs :
// `ORDEN_SECCIONES` (ordre d'affichage, `lib/catalog/tipos.ts`) et `segmentoDeTipo` (type → segment
// d'URL, `lib/catalog/segmentos.ts`). Cette fonction ne fait que les composer avec la traduction —
// aucune nouvelle règle n'est introduite ici, donc aucune clé i18n nouvelle : `HomePage.secciones.*`
// existe déjà en es/en.
//
// ⚠️ Ce module reste SERVEUR (`getTranslations`, pas `useTranslations`) et n'importe de `tipos.ts`
// que des types/constantes sans dépendance — comme `labelsBuscador.ts`, ça évite de faire entrer le
// barrel `@hifago/ui` dans le graphe d'un Server Component par transitivité (CLAUDE.md §11.16).
// ⚠️ `sufijoCriterios` (2026-09-16, bug Jérôme : « en changeant de page les filtres s'enlèvent »)
// est calculé par l'appelant, jamais recalculé ici — même contrat que `hrefSeccion`/
// `hrefCategoria` (`lib/catalog/buscar.ts`), qui composent déjà ce même suffixe.
export async function tiposDeBarra(
  locale: Locale,
  sufijoCriterios: string
): Promise<{ tipo: TipoOferta; label: string; href: string }[]> {
  const t = await getTranslations({ locale, namespace: "HomePage" });

  return ORDEN_SECCIONES.map((tipo) => ({
    tipo,
    label: t(`secciones.${tipo}`),
    href: `/${segmentoDeTipo(tipo)}${sufijoCriterios}`,
  }));
}
