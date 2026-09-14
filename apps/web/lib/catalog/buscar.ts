import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
// ⚠️ Le MÊME prédicat que le sitemap et que les `generateMetadata` des fiches — jamais une
// deuxième version : deux copies divergeraient, et le sitemap listerait des URL que les
// métadonnées déclarent `noindex`. Le module est un prédicat pur, sans dépendance.
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { routing } from "@/i18n/routing";
import { ordenarTipos } from "./ordenSecciones";
import { segmentoDeTipo } from "./segmentos";
import {
  ORDEN_SECCIONES,
  esTipoOferta,
  resolverPrecio,
  type Criterios,
  type FotoTarjeta,
  type PrecioTarjeta,
  type Seccion,
  type CategoriaConTarjetas,
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
 * Les colonnes CARTE communes à `search_catalog` et `search_catalog_categorias` — cette dernière
 * ajoute juste les colonnes de catégorie et remplace `total_seccion`/`rango_seccion` par leurs
 * équivalents par catégorie. `enTarjeta` ne lit que cette forme : les deux RPC s'y convertissent
 * sans mapper deux fois la même chose.
 */
type FilaCarta = {
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
  /** `null` sur toute carte non groupée — cf. la note dans `enTarjeta`. */
  n_alojamientos: number | null;
};

/**
 * Une ligne brute de `search_catalog`. Exportée depuis le 2026-09-08 : `sugerencias.ts` lit la
 * MÊME RPC, donc il lui faut la même forme de ligne — pas une seconde description de la même chose.
 */
export type FilaCatalogo = FilaCarta & {
  total_seccion: number;
  rango_seccion: number;
};

/** Une ligne brute de `search_catalog_categorias` — une carte, rattachée à SA catégorie. */
type FilaCategoria = FilaCarta & {
  /** `null` sur la ligne de rattrapage (`es_sin_tag`) — pas une ligne de `catalog_tags`. */
  categoria_slug: string | null;
  categoria_label: unknown;
  categoria_description: unknown;
  categoria_image_path: string | null;
  es_sin_tag: boolean;
  total_categoria: number;
  rango_categoria: number;
};

/**
 * Le prix d'une carte du catalogue. UNE seule chose lui est propre : une carte GROUPÉE affiche le
 * minimum de ses couchages (`desde`), ce qu'aucun autre écran ne fait.
 *
 * ⚠️ Le reste délègue à `resolverPrecio` depuis le 2026-09-08, et ce n'est pas cosmétique : cette
 * fonction testait le MONTANT avant le LIBELLÉ, l'inverse des deux autres écrans. Un produit
 * portant les deux se serait affiché « 120.000 COP » ici et « Consultar » sur sa propre fiche.
 */
function precioDe(fila: FilaCarta): PrecioTarjeta {
  if (fila.es_establecimiento) {
    return fila.precio_desde != null ? { tipo: "desde", cop: fila.precio_desde } : null;
  }
  return resolverPrecio(fila.precio_label, fila.precio_cop);
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
export function identidadDeFila(fila: FilaCarta, locale: string) {
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
  fila: FilaCarta,
  locale: string,
  urlPublica: (ruta: string) => string
): TarjetaOferta | null {
  if (!esTipoOferta(fila.tipo)) return null; // un type inconnu ne casse pas la page, il disparaît

  return {
    ...identidadDeFila(fila, locale),
    precio: precioDe(fila),
    fotos: fotosDe(fila.fotos, urlPublica),
    tipo: fila.tipo,
    // ⚠️ `?? null` n'est PAS décoratif : le type généré annonce `n_alojamientos: number`, alors
    // que la colonne vaut `null` sur toute carte non groupée. Postgres ne déclare aucune
    // nullabilité dans un `returns table`, donc `database.types.ts` ne peut pas la connaître —
    // le typage ment ici, et c'est le seul endroit où on peut le rattraper.
    nAlojamientos: fila.n_alojamientos ?? null,
    // `search_catalog` ne rend pas la capacité : elle n'est demandée que sur les cartes de chambre
    // d'une fiche établissement, qui les construit elle-même (spec 30 §5d).
    capacidad: null,
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
 *
 * `tiposEnCarrito` (spec 28 Tranche 3) : quand fourni, les sections sont réordonnées selon
 * `ordenarTipos` au lieu de `ORDEN_SECCIONES` — appelé par `page.tsx` seulement juste après un
 * ajout au panier (cahier §2b.5, décision Jérôme : jamais à une simple visite de l'accueil).
 */
export async function buscarSecciones(
  criterios: Criterios,
  {
    porSeccion,
    locale,
    tiposEnCarrito,
  }: { porSeccion: number; locale: string; tiposEnCarrito?: ReadonlySet<TipoOferta> }
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
  // elle est absente du tableau : le composant n'a aucune décision à prendre. `tiposEnCarrito`
  // substitue l'ordre habituel par la partition de la spec 28 Tranche 3 ; le filtre des sections
  // vides est inchangé dans les deux cas.
  const orden = tiposEnCarrito ? ordenarTipos(tiposEnCarrito) : ORDEN_SECCIONES;
  return orden.map((tipo) => porTipo.get(tipo)).filter(
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

/** Le lien « Ver más » d'une catégorie : sa page dédiée, critères conservés. */
export function hrefCategoria(tipo: TipoOferta, slug: string, sufijoCriterios: string): string {
  return `/${segmentoDeTipo(tipo)}/${slug}${sufijoCriterios}`;
}

/** Le slug RÉSERVÉ de la catégorie qu'aucun tag ne classe, pour tout type (spec 29 §6a,
 *  généralisée 2026-09-14 — portait seulement sur `/actividades` jusque-là).
 *
 *  ⚠️ Il est aussi interdit à `catalog_tags` par une contrainte SQL — la valeur vit donc à deux
 *  endroits, et c'est assumé : le TypeScript ne peut pas lire une contrainte Postgres. Le test
 *  pgTAP `search_catalog_categorias.test.sql` tient l'autre bout. */
export const SLUG_SIN_TAG = "otras";

/**
 * Les CATÉGORIES d'UN type, chacune avec ses items PLAFONNÉS (spec 29 §7a, généralisée à tout
 * `TipoOferta` le 2026-09-14 — remplace `listarTagsConOferta`, qui ne rendait que l'index SANS
 * items et seulement pour `activity`). Sert deux usages avec la MÊME lecture : l'index d'un type
 * (`porCategoria` élevé, les `tarjetas` s'affichent) et la résolution d'une page `[categoria]`
 * (`porCategoria: 1`, seuls `slug`/`nombre`/`descripcion`/`esSinTag`/`localesNativas` sont lus).
 *
 * ⚠️ Elle prend les CRITÈRES et la LOCALE : l'index respecte la recherche en cours (décision 3 —
 * une catégorie ne mène jamais à une page vide), et l'ordre alphabétique porte sur le libellé
 * résolu, donc dépend de la langue.
 *
 * ⚠️ LE TRI EST FAIT ICI, PAS EN SQL, et ce n'est pas un choix de commodité : la base ne connaît ni
 * la locale demandée ni le repli JSONB. Un `order by label->>'es'` classerait la version anglaise
 * par ses libellés espagnols, et ignorerait la collation — « Ñandú » après « Zip line », les accents
 * rangés au hasard. `Intl.Collator` fait les deux correctement.
 */
export async function buscarCategorias(
  tipo: TipoOferta,
  criterios: Criterios,
  { porCategoria, locale }: { porCategoria: number; locale: string }
): Promise<CategoriaConTarjetas[]> {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("search_catalog_categorias", {
    p_tipo: tipo,
    p_query: criterios.q ?? undefined,
    p_personas: criterios.personas ?? undefined,
    p_desde: criterios.desde ?? undefined,
    p_hasta: criterios.hasta ?? undefined,
    p_por_categoria: porCategoria,
  });

  // Échec franc : un index de catégories vide rendu comme un index normal ferait croire au visiteur
  // qu'il n'y a rien à visiter. Même règle qu'`buscarSecciones` (CLAUDE.md §4.4, en lecture).
  if (error) throw error;

  const urlPublica = (ruta: string) =>
    supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

  const segmento = segmentoDeTipo(tipo);
  const porSlug = new Map<string, CategoriaConTarjetas>();
  let sinTag: CategoriaConTarjetas | null = null;

  for (const fila of (data ?? []) as FilaCategoria[]) {
    const tarjeta = enTarjeta(fila, locale, urlPublica);
    if (!tarjeta) continue;

    if (fila.es_sin_tag) {
      // ⚠️ `nombre` et `descripcion` restent VIDES : la catégorie de rattrapage n'est pas une
      // ligne de `catalog_tags`, ses libellés viennent de next-intl et donc de la page. Cette
      // couche ne traduit rien (spec 29 §0).
      sinTag ??= {
        slug: SLUG_SIN_TAG,
        href: `/${segmento}/${SLUG_SIN_TAG}`,
        nombre: "",
        descripcion: null,
        foto: null,
        esSinTag: true,
        // ⚠️ Native PARTOUT : ses libellés viennent de next-intl (jeu d'interface fermé et complet
        // dans les deux locales), pas du contenu partenaire. Sa page est donc indexable dans les
        // deux langues, contrairement à une catégorie rédigée dans une seule.
        localesNativas: [...routing.locales],
        tarjetas: [],
        total: fila.total_categoria,
        testId: `categoria-${SLUG_SIN_TAG}`,
      };
      sinTag.tarjetas.push(tarjeta);
      continue;
    }

    // Une ligne sans slug ne peut pas être un lien : elle disparaît plutôt que de casser la page.
    if (!fila.categoria_slug) continue;

    const categoria = porSlug.get(fila.categoria_slug) ?? {
      slug: fila.categoria_slug,
      href: `/${segmento}/${fila.categoria_slug}`,
      // Repli sur le slug : une catégorie sans libellé dans aucune langue reste cliquable.
      nombre: resolveLocalizedField(asLocalizedField(fila.categoria_label), locale) ?? fila.categoria_slug,
      descripcion: resolveLocalizedField(asLocalizedField(fila.categoria_description), locale) ?? null,
      foto: fila.categoria_image_path ? { url: urlPublica(fila.categoria_image_path) } : null,
      esSinTag: false,
      localesNativas: routing.locales.filter((candidate) =>
        hasNativeContent(fila.categoria_label, candidate)
      ),
      tarjetas: [],
      total: fila.total_categoria,
      testId: `categoria-${fila.categoria_slug}`,
    };
    categoria.tarjetas.push(tarjeta);
    porSlug.set(fila.categoria_slug, categoria);
  }

  const categorias = [...porSlug.values()];
  const collator = new Intl.Collator(locale);
  categorias.sort((a, b) => collator.compare(a.nombre, b.nombre));

  // ⚠️ La catégorie de rattrapage TOUJOURS EN DERNIER, jamais dans l'ordre alphabétique : ce n'est
  // pas une catégorie parmi les autres, c'est ce qui reste. La placer entre « Kayak » et
  // « Senderismo » laisserait croire à une catégorie éditoriale de plus.
  return sinTag ? [...categorias, sinTag] : categorias;
}
