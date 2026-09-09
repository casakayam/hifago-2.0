// La table type d'offre ↔ segment d'URL, SEULE source de vérité (spec 28 §7).
//
// Les URL sont en espagnol dans les deux locales (décision de Jérôme du 2026-09-07) : il n'y a donc
// qu'une table, pas une par langue, et `next-intl` `pathnames` n'est pas utilisé.
//
// Elle est bidirectionnelle parce que les deux sens servent : construire un lien « Ver más »
// (type → segment) et lire le paramètre d'une page de listing (segment → type).

import { ORDEN_SECCIONES, type TipoOferta } from "./tipos";

const SEGMENTO_POR_TIPO: Record<TipoOferta, string> = {
  activity: "actividades",
  lodging: "alojamientos",
  transport: "transportes",
  camp: "camps",
  evento: "eventos",
};

const TIPO_POR_SEGMENTO: Record<string, TipoOferta> = Object.fromEntries(
  ORDEN_SECCIONES.map((tipo) => [SEGMENTO_POR_TIPO[tipo], tipo])
) as Record<string, TipoOferta>;

export function segmentoDeTipo(tipo: TipoOferta): string {
  return SEGMENTO_POR_TIPO[tipo];
}

/** `undefined` sur un segment inconnu — jamais une exception : une URL est saisie par des humains. */
export function tipoDeSegmento(segmento: string): TipoOferta | undefined {
  return TIPO_POR_SEGMENTO[segmento];
}

