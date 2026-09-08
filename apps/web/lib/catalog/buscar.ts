import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
// ⚠️ Le MÊME prédicat que le sitemap et que les `generateMetadata` des fiches — jamais une
// deuxième version : deux copies divergeraient, et le sitemap listerait des URL que les
// métadonnées déclarent `noindex`. Le module est un prédicat pur, sans dépendance.
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { routing } from "@/i18n/routing";
import { segmentoDeTipo } from "./segmentos";
import {
  ORDEN_SECCIONES,
  esTipoOferta,
  type Criterios,
  type FotoTarjeta,
  type PrecioTarjeta,
  type Seccion,
  type CategoriaConOferta,
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

/**
 * Une ligne brute de `search_catalog`. Exportée depuis le 2026-09-08 : `sugerencias.ts` lit la
 * MÊME RPC, donc il lui faut la même forme de ligne — pas une seconde description de la même chose.
 */
export type FilaCatalogo = {
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

/**
 * L'IDENTITÉ d'une ligne du catalogue : sa clé, son chemin, son nom, son établissement.
 *
 * Extraite d'`enTarjeta` le 2026-09-08 (spec 28 Tranche 2), parce qu'une SUGGESTION de la barre de
 * recherche désigne exactement la même offre qu'une carte et doit donc la désigner PAREIL. Deux
 * copies de ces quatre lignes ne resteraient pas identiques : le jour où une fiche change de
 * segment d'URL, la carte irait au bon endroit et la suggestion qui la nomme au mauvais — sans
 * qu'aucun test des deux modules ne devienne rouge, puisque chacun vérifierait sa propre copie.
 *
 * ⚠️ Rend des DONNÉES, jamais un libellé d'interface : `nombre` est du contenu partenaire (JSONB
 * résolu), pas une phrase composée. C'est ce qui permet de la partager avec une couche qui, elle,
 * n'affiche rien.
 */
export function identidadDeFila(fila: FilaCatalogo, locale: string) {
  return {
    clave: `${fila.es_establecimiento ? "establecimiento" : "producto"}-${fila.id}`,
    href: fila.es_establecimiento
      ? `/establecimientos/${fila.slug}`
      : `/productos/${fila.slug}`,
    // Repli sur le slug : une fiche sans nom dans aucune langue reste cliquable plutôt que vide.
    nombre: resolveLocalizedField(asLocalizedField(fila.nombre), locale) ?? fila.slug,
    establecimiento: nombreEstablecimiento(fila.establecimiento, locale),
  };
}

function enTarjeta(
  fila: FilaCatalogo,
  locale: string,
  urlPublica: (ruta: string) => string
): TarjetaOferta | null {
  if (!esTipoOferta(fila.tipo)) return null; // un type inconnu ne casse pas la page, il disparaît

  return {
    ...identidadDeFila(fila, locale),
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

/**
 * Une page de listing : un seul type, sans plafond par section, paginé pour le défilement.
 *
 * ⚠️ `sinTag` est une OPTION, jamais un critère (spec 29 §7a). Il vient du segment d'URL
 * `/actividades/otras`, pas d'un paramètre de recherche : le mettre dans `Criterios` le ferait
 * écrire dans les liens par `escribirCriterios`, et « les activités que personne n'a classées »
 * deviendrait un filtre partageable qui n'a de sens que sur cette page-là.
 */
export async function buscarTipo(
  tipo: TipoOferta,
  criterios: Criterios,
  {
    limite,
    desplazamiento,
    locale,
    sinTag,
  }: { limite: number; desplazamiento: number; locale: string; sinTag?: boolean }
): Promise<{ tarjetas: TarjetaOferta[]; total: number; hayMas: boolean }> {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("search_catalog", {
    ...argumentos(criterios, [tipo]),
    // `undefined` plutôt que `false` : la RPC porte son propre défaut, et n'envoyer que ce qui
    // filtre garde les appels lisibles dans les journaux Postgres.
    p_sin_tag: sinTag ? true : undefined,
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

/** Le slug RÉSERVÉ de la page des activités qu'aucune catégorie ne classe (spec 29 §6a).
 *
 *  ⚠️ Il est aussi interdit à `catalog_tags` par une contrainte SQL — la valeur vit donc à deux
 *  endroits, et c'est assumé : le TypeScript ne peut pas lire une contrainte Postgres. Le test
 *  pgTAP `search_catalog_tags.test.sql` tient l'autre bout. */
export const SLUG_SIN_TAG = "otras";

/**
 * Les CATÉGORIES à montrer sur `/es/actividades` (spec 29 §7a).
 *
 * ⚠️ Elle prend les CRITÈRES et la LOCALE, là où la spec 27 §0 annonçait `listarTagsConOferta(tipo)` :
 * l'index respecte la recherche en cours (décision 3 — une tuile ne mène jamais à une page vide), et
 * l'ordre alphabétique porte sur le libellé résolu, donc dépend de la langue.
 *
 * ⚠️ LE TRI EST FAIT ICI, PAS EN SQL, et ce n'est pas un choix de commodité : la base ne connaît ni
 * la locale demandée ni le repli JSONB. Un `order by label->>'es'` classerait la version anglaise
 * par ses libellés espagnols, et ignorerait la collation — « Ñandú » après « Zip line », les accents
 * rangés au hasard. `Intl.Collator` fait les deux correctement.
 */
export async function listarTagsConOferta(
  tipo: TipoOferta,
  criterios: Criterios,
  { locale }: { locale: string }
): Promise<CategoriaConOferta[]> {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("search_catalog_tags", {
    p_tipo: tipo,
    p_query: criterios.q ?? undefined,
    p_personas: criterios.personas ?? undefined,
    p_desde: criterios.desde ?? undefined,
    p_hasta: criterios.hasta ?? undefined,
  });

  // Échec franc : un index de catégories vide rendu comme un index normal ferait croire au visiteur
  // qu'il n'y a rien à visiter. Même règle qu'`buscarSecciones` (CLAUDE.md §4.4, en lecture).
  if (error) throw error;

  const urlPublica = (ruta: string) =>
    supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

  type FilaTag = {
    slug: string | null;
    label: unknown;
    description: unknown;
    image_path: string | null;
    total: number;
    es_sin_tag: boolean;
  };

  const categorias: CategoriaConOferta[] = [];
  let sinTag: CategoriaConOferta | null = null;

  for (const fila of (data ?? []) as FilaTag[]) {
    if (fila.es_sin_tag) {
      // ⚠️ `nombre` et `descripcion` restent VIDES : « Otras actividades » n'est pas une ligne de
      // `catalog_tags`, ses libellés viennent de next-intl et donc de la page. Cette couche ne
      // traduit rien (spec 29 §0).
      sinTag = {
        slug: SLUG_SIN_TAG,
        href: `/actividades/${SLUG_SIN_TAG}`,
        nombre: "",
        descripcion: null,
        foto: null,
        esSinTag: true,
        // ⚠️ Native PARTOUT : ses libellés viennent de next-intl (jeu d'interface fermé et complet
        // dans les deux locales), pas du contenu partenaire. Sa page est donc indexable dans les
        // deux langues, contrairement à une catégorie rédigée dans une seule.
        localesNativas: [...routing.locales],
        testId: `categoria-${SLUG_SIN_TAG}`,
      };
      continue;
    }

    // Une ligne sans slug ne peut pas être un lien : elle disparaît plutôt que de casser la page.
    if (!fila.slug) continue;

    categorias.push({
      slug: fila.slug,
      href: `/actividades/${fila.slug}`,
      // Repli sur le slug : une catégorie sans libellé dans aucune langue reste cliquable.
      nombre: resolveLocalizedField(asLocalizedField(fila.label), locale) ?? fila.slug,
      descripcion: resolveLocalizedField(asLocalizedField(fila.description), locale) ?? null,
      foto: fila.image_path ? { url: urlPublica(fila.image_path) } : null,
      esSinTag: false,
      localesNativas: routing.locales.filter((candidate) =>
        hasNativeContent(fila.label, candidate)
      ),
      testId: `categoria-${fila.slug}`,
    });
  }

  const collator = new Intl.Collator(locale);
  categorias.sort((a, b) => collator.compare(a.nombre, b.nombre));

  // ⚠️ « Otras actividades » TOUJOURS EN DERNIER, jamais dans l'ordre alphabétique : ce n'est pas
  // une catégorie parmi les autres, c'est ce qui reste. La placer entre « Kayak » et « Senderismo »
  // laisserait croire à une catégorie éditoriale de plus.
  return sinTag ? [...categorias, sinTag] : categorias;
}
