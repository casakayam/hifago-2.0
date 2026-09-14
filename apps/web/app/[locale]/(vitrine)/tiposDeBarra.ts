import { getTranslations } from "next-intl/server";
import { ORDEN_SECCIONES, type TipoOferta } from "@/lib/catalog/tipos";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { Locale } from "@/messages";

// Les cinq onglets de type de la barre de navigation, construits UNE fois pour les cinq écrans qui
// la montent : l'accueil (`page.tsx`), les cinq listings (`ListadoTipo.tsx`), l'index de catégories
// (`actividades/page.tsx`) et les deux fiches (`establecimientos/[slug]/page.tsx`,
// `productos/[slug]/page.tsx`). Même raison que `labelsBuscador.ts` : recopier `ORDEN_SECCIONES.map`
// cinq fois exposerait le même risque de divergence silencieuse — un ordre changé ou un libellé
// oublié sur un seul écran compile, passe le lint, et ne casse aucun test.
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
export async function tiposDeBarra(
  locale: Locale
): Promise<{ tipo: TipoOferta; label: string; href: string }[]> {
  const t = await getTranslations({ locale, namespace: "HomePage" });

  return ORDEN_SECCIONES.map((tipo) => ({
    tipo,
    label: t(`secciones.${tipo}`),
    href: `/${segmentoDeTipo(tipo)}`,
  }));
}
