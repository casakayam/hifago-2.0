import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
import { segmentoDeTipo } from "./segmentos";
import {
  ORDEN_SECCIONES,
  esTipoOferta,
  type Criterios,
  type FotoTarjeta,
  type PrecioTarjeta,
  type Seccion,
  type TarjetaOferta,
  type TipoOferta,
} from "./tipos";

// La couche d'accès au catalogue (spec 27). C'est le SEUL endroit d'où part une requête Supabase
// pour la vitrine : aucun `page.tsx` n'appelle `.from()` ni `createClient()` (invariant 2 de la
// spec 27, vérifié par `scripts/check-data-layer.sh`).
//
// ⚠️ **Ce module est réservé au serveur, et RIEN ne le force aujourd'hui.** La spec 27 prévoyait
// `import "server-only"` en tête — le paquet n'est ni installé, ni déclaré, ni utilisé nulle part
// dans le dépôt (vérifié le 2026-09-07), et ajouter une dépendance ne se fait pas au détour d'un
// lot. En attendant, deux choses tiennent la frontière : ce module n'est importé que par des
// Server Components, et `scripts/check-data-layer.sh` (spec 27) interdit à un `page.tsx` de parler
// à Supabase directement. Ce qui n'est PAS couvert : un composant client qui importerait ce
// fichier — il embarquerait alors la clé anonyme et le graphe Supabase dans le bundle, sans erreur.
// Décision d'une ligne à prendre : ajouter `server-only` (paquet officiel Next, sans code) ou non.
//
// Le client est ANONYME et SANS COOKIES (`createPublicClient`) : la RLS `_select_public` s'applique
// pleinement, et l'absence de `cookies()` est ce qui rendra les fiches cacheables (spec 27 §8).
//
// ⚠️ Ce module ne traduit RIEN d'autre que le contenu partenaire (les champs JSONB, via
// `resolveLocalizedField`). Le texte alternatif d'une photo est du TEXTE D'INTERFACE : il est
// construit par le composant qui l'affiche, à partir de `nombre` et du rang, avec son propre
// traducteur. Écart assumé à la spec 28 §0, qui faisait rendre `alt` par cette couche — l'y mettre
// coupleraient `lib/catalog/` à next-intl et le rendrait intestable sans contexte i18n.

const BUCKET_MEDIA = "catalog-media";

type FilaCatalogo = {
  tipo: string;
  es_establecimiento: boolean;
  id: string;
  slug: string;
  nombre: unknown;
  descripcion: unknown;
  precio_cop: number | null;
  precio_desde: number | null;
  precio_label: string | null;
  establecimiento: unknown;
  fotos: unknown;
  total_seccion: number;
  rango_seccion: number;
};

function precioDe(fila: FilaCatalogo): PrecioTarjeta {
  if (fila.es_establecimiento) {
    return fila.precio_desde != null ? { tipo: "desde", cop: fila.precio_desde } : null;
  }
  if (fila.precio_cop != null) return { tipo: "monto", cop: fila.precio_cop };
  if (fila.precio_label) return { tipo: "texto", label: fila.precio_label };
  return null;
}

function nombreEstablecimiento(valor: unknown, locale: string): string | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = (valor as { nombre?: unknown }).nombre;
  return resolveLocalizedField(asLocalizedField(bruto), locale) ?? null;
}

function fotosDe(
  valor: unknown,
  urlPublica: (ruta: string) => string
): FotoTarjeta[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((f) => (f && typeof f === "object" ? (f as { storage_path?: unknown }).storage_path : null))
    .filter((ruta): ruta is string => typeof ruta === "string" && ruta.length > 0)
    .map((ruta) => ({ url: urlPublica(ruta) }));
}

function enTarjeta(
  fila: FilaCatalogo,
  locale: string,
  urlPublica: (ruta: string) => string
): TarjetaOferta | null {
  if (!esTipoOferta(fila.tipo)) return null; // un type inconnu ne casse pas la page, il disparaît

  const href = fila.es_establecimiento
    ? `/establecimientos/${fila.slug}`
    : `/productos/${fila.slug}`;

  return {
    clave: `${fila.es_establecimiento ? "establecimiento" : "producto"}-${fila.id}`,
    href,
    // Repli sur le slug : une fiche sans nom dans aucune langue reste cliquable plutôt que vide.
    nombre: resolveLocalizedField(asLocalizedField(fila.nombre), locale) ?? fila.slug,
    establecimiento: nombreEstablecimiento(fila.establecimiento, locale),
    precio: precioDe(fila),
    fotos: fotosDe(fila.fotos, urlPublica),
    tipo: fila.tipo,
    testId: `tarjeta-${fila.slug}`,
  };
}

function argumentos(criterios: Criterios, tipos: TipoOferta[] | null) {
  return {
    p_query: criterios.q ?? undefined,
    p_tipos: tipos ?? undefined,
    p_tag_slug: criterios.tag ?? undefined,
    p_personas: criterios.personas ?? undefined,
    p_desde: criterios.desde ?? undefined,
    p_hasta: criterios.hasta ?? undefined,
  };
}

/**
 * L'accueil et l'écran de résultats : toutes les sections, plafonnées, les vides retirées.
 *
 * ⚠️ Le plafond `porSeccion` est appliqué PAR LA BASE (`p_por_tipo`), pas ici — parce que le
 * regroupement des couchages d'un même établissement se fait en SQL et doit précéder le
 * plafonnement : plafonner huit PRODUITS puis grouper donnerait moins de huit CARTES (spec 27 §10).
 *
 * `p_limite` doit couvrir toutes les sections plafonnées, sinon la dernière est tronquée par la
 * limite globale — piège invisible, la page rendrait juste moins de cartes sans erreur.
 */
export async function buscarSecciones(
  criterios: Criterios,
  { porSeccion, locale }: { porSeccion: number; locale: string }
): Promise<Seccion[]> {
  const supabase = createPublicClient();
  const tipos = criterios.tipo ? [criterios.tipo] : null;

  const { data, error } = await supabase.rpc("search_catalog", {
    ...argumentos(criterios, tipos),
    p_por_tipo: porSeccion,
    p_limite: porSeccion * ORDEN_SECCIONES.length,
    p_offset: 0,
  });

  // Échec franc : un catalogue vide rendu comme un catalogue normal ferait croire au client qu'il
  // n'y a rien à vendre. C'est la déclinaison en lecture de la règle d'échec fermé (CLAUDE.md §4.4).
  if (error) throw error;

  const urlPublica = (ruta: string) =>
    supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

  const porTipo = new Map<TipoOferta, Seccion>();
  for (const fila of (data ?? []) as FilaCatalogo[]) {
    const tarjeta = enTarjeta(fila, locale, urlPublica);
    if (!tarjeta) continue;
    const seccion = porTipo.get(tarjeta.tipo) ?? {
      tipo: tarjeta.tipo,
      tarjetas: [],
      total: fila.total_seccion,
    };
    seccion.tarjetas.push(tarjeta);
    porTipo.set(tarjeta.tipo, seccion);
  }

  // L'ordre vient d'ici, jamais d'un composant (cahier §2a) — et une section vide n'est pas rendue,
  // elle est absente du tableau : le composant n'a aucune décision à prendre.
  return ORDEN_SECCIONES.map((tipo) => porTipo.get(tipo)).filter(
    (seccion): seccion is Seccion => seccion !== undefined
  );
}

/** Une page de listing : un seul type, sans plafond par section, paginé pour le défilement. */
export async function buscarTipo(
  tipo: TipoOferta,
  criterios: Criterios,
  { limite, desplazamiento, locale }: { limite: number; desplazamiento: number; locale: string }
): Promise<{ tarjetas: TarjetaOferta[]; total: number; hayMas: boolean }> {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("search_catalog", {
    ...argumentos(criterios, [tipo]),
    p_por_tipo: undefined,
    p_limite: limite,
    p_offset: desplazamiento,
  });
  if (error) throw error;

  const urlPublica = (ruta: string) =>
    supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

  const filas = (data ?? []) as FilaCatalogo[];
  const tarjetas = filas
    .map((fila) => enTarjeta(fila, locale, urlPublica))
    .filter((t): t is TarjetaOferta => t !== null);

  const total = filas[0]?.total_seccion ?? 0;
  return { tarjetas, total, hayMas: desplazamiento + filas.length < total };
}

/** Le lien « Ver más » d'une section : le listing du type, critères conservés. */
export function hrefSeccion(tipo: TipoOferta, sufijoCriterios: string): string {
  return `/${segmentoDeTipo(tipo)}${sufijoCriterios}`;
}
