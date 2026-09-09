import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { Migas } from "@/components/molecules/Migas";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { ListadoInfinito } from "@/components/organisms/ListadoInfinito";
import { buscarTipo } from "@/lib/catalog/buscar";
import {
  TAMANO_PAGINA,
  escribirCriterios,
  hayCriterios,
  leerCriterios,
  leerPagina,
  type ParamsBrutos,
} from "@/lib/catalog/criterios";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { TipoOferta } from "@/lib/catalog/tipos";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasParaJsonLd } from "@/lib/seo/migas";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";

// LE CORPS DES QUATRE PAGES DE LISTING (2026-09-08, spec 29 §5c/§5d).
//
// ⚠️ POURQUOI UN FICHIER PARTAGÉ PLUTÔT QUE QUATRE PAGES. `/alojamientos`, `/transportes`,
// `/camps` et `/eventos` ne diffèrent que par UNE valeur : le type. Écrire quatre fois le même
// écran mettrait la taille de page, le fil d'Ariane, le choix de l'état vide et la construction de
// l'URL du pont à quatre endroits — et la première divergence ne casserait aucun test, elle
// rendrait juste une des quatre pages subtilement différente des autres.
//
// Il n'est PAS dans `components/` : il appelle `lib/catalog/` (réservé au serveur), il traduit, et
// il pose le JSON-LD. C'est un morceau de route, colocalisé dans son groupe — même statut que
// `BuscadorInicio`, à côté duquel il vit.
//
// ⚠️ `page.tsx` n'appelle donc AUCUNE requête et n'importe rien de `@hifago/ui` : les deux règles
// vérifiées par `scripts/check-data-layer.sh` sont tenues par construction pour les quatre routes.

/** Le fil d'Ariane et le titre partagent la même source — jamais deux libellés parallèles. */
async function libelles(tipo: TipoOferta, locale: Locale) {
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  // ⚠️ La MÊME clé que la section correspondante de l'accueil. Un second jeu de titres divergerait
  // à la première retouche, et le visiteur lirait « Alojamientos » sur l'accueil et autre chose en
  // arrivant sur la page que ce lien annonce.
  return { seccion: tHome(`secciones.${tipo}`), inicio: tCommon("breadcrumbHome") };
}

/**
 * Ce qu'il faut savoir d'une catégorie pour rendre SA page (spec 29 §5b).
 *
 * ⚠️ `esSinTag` change la REQUÊTE, pas seulement l'affichage : « Otras actividades » ne filtre pas
 * sur un tag, elle demande les offres qui n'en portent AUCUN (`p_sin_tag` de `search_catalog`).
 */
export type CategoriaDeListado = {
  slug: string;
  /** Déjà résolu : le nom de la catégorie, ou celui de `messages/` pour « Otras actividades ». */
  nombre: string;
  /** Déjà résolu, `null` si la catégorie n'est pas rédigée. */
  descripcion: string | null;
  esSinTag: boolean;
};

/** Les métadonnées d'une page de listing — appelée par le `generateMetadata` de chaque route. */
export async function metadataListado(tipo: TipoOferta, locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion } = await libelles(tipo, locale);

  // Pas de `nativeLocales` : ces textes viennent de next-intl (jeu d'interface fermé et complet
  // dans les deux locales), pas du contenu partenaire soumis au repli JSONB.
  //
  // ⚠️ `pathFor` ne reçoit AUCUN paramètre — le canonical ignore donc `?q=`, `?personas=` et
  // surtout `?pagina=` (spec 29 §0, invariant 4). Sans ça, chaque profondeur de défilement
  // fabriquerait une URL indexable distincte de la même page.
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/${segmentoDeTipo(tipo)}`,
    title: t("meta.title", { seccion }),
    description: t("meta.description", { seccion: seccion.toLowerCase() }),
  });
}

/**
 * Les métadonnées d'une page de CATÉGORIE.
 *
 * ⚠️ `nativeLocales` n'est PAS laissé au défaut ici, contrairement aux listings : le nom et le texte
 * d'une catégorie sont du CONTENU PARTENAIRE (JSONB), pas de l'interface. Une page servie en repli
 * — nom espagnol sous une URL `/en/` — doit rester `noindex` avec un canonical vers la langue
 * source (règle SEO 2), sinon Google indexe deux URL portant le même texte espagnol.
 *
 * L'exception est « Otras actividades », dont les libellés viennent de next-intl : elle est native
 * dans les deux locales, comme n'importe quel écran d'interface.
 */
export async function metadataCategoria(
  categoria: CategoriaDeListado,
  locale: Locale,
  nativeLocales?: readonly string[]
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/actividades/${categoria.slug}`,
    title: t("meta.title", { seccion: categoria.nombre }),
    description: categoria.descripcion ?? t("meta.description", { seccion: categoria.nombre }),
    nativeLocales,
  });
}

export async function ListadoTipo({
  tipo,
  locale,
  searchParams,
  categoria,
}: {
  tipo: TipoOferta;
  locale: Locale;
  searchParams: ParamsBrutos;
  /** Présente uniquement sur `/actividades/[tag]` — les quatre listings n'en ont pas. */
  categoria?: CategoriaDeListado;
}) {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion, inicio } = await libelles(tipo, locale);

  // ⚠️ `tipo` de l'URL est IGNORÉ (spec 29 §0) : le type vient du segment, qui fait foi. Un
  // `/es/camps?tipo=lodging` liste des camps — l'adresse dit ce que la page montre.
  //
  // ⚠️ `delete` plutôt qu'un `tipo: undefined` : `hayCriterios` compte les CLÉS présentes, et une
  // clé posée à `undefined` compte pour un filtre. La page choisirait alors « ta recherche ne
  // donne rien » là où il faut « cette section est encore vide » — sur une route où personne n'a
  // rien cherché.
  const criterios = { ...leerCriterios(searchParams) };
  delete criterios.tipo;
  const pagina = leerPagina(searchParams);

  // ⚠️ LA seule requête de la page, et elle ne part pas d'un fichier de route.
  //
  // Ouvrir `?pagina=3` rend les TROIS pages d'un coup, pas la seule troisième tranche : le cas
  // d'usage de ce paramètre est le retour depuis une fiche, et une liste tronquée par le haut
  // n'aurait aucun sens. `leerPagina` a déjà plafonné — c'est ce qui empêche cette multiplication
  // de devenir un vecteur de charge.
  // ⚠️ Sur une page de catégorie, le filtre vient du SEGMENT, jamais d'un `?tag=` : c'est l'adresse
  // qui décide de ce que la page montre. Un `?tag=buceo` sur `/actividades/kayak` est donc écrasé,
  // exactement comme `?tipo=` l'est sur un listing.
  const criteriosDeConsulta = categoria?.esSinTag
    ? { ...criterios, tag: undefined }
    : categoria
      ? { ...criterios, tag: categoria.slug }
      : criterios;

  const { tarjetas, total, hayMas } = await buscarTipo(tipo, criteriosDeConsulta, {
    limite: pagina * TAMANO_PAGINA,
    desplazamiento: 0,
    locale,
    sinTag: categoria?.esSinTag,
  });

  const segmento = segmentoDeTipo(tipo);

  // Deux ou trois niveaux selon l'écran, et le titre de la page est TOUJOURS le dernier — c'est ce
  // qui garantit que le fil et le `<h1>` ne peuvent pas se contredire : ils sortent d'ici tous les
  // deux (décision 13).
  const titulo = categoria ? categoria.nombre : seccion;
  const migas = categoria
    ? [
        { nombre: inicio, href: "/" },
        { nombre: seccion, href: `/${segmento}` },
        { nombre: titulo },
      ]
    : [{ nombre: inicio, href: "/" }, { nombre: titulo }];
  const rutaCanonica = categoria ? `/${segmento}/${categoria.slug}` : `/${segmento}`;

  const labels = await labelsBuscador(locale as Locale);

  // L'URL du pont, critères compris et SANS `pagina` : `ListadoInfinito` y ajoute la sienne.
  //
  // ⚠️ Les critères sont sérialisés par `escribirCriterios`, et pas par six `if` écrits ici : c'est
  // l'ÉCRIVAIN symétrique du `leerCriterios` que le pont utilise pour les relire
  // (`api/catalogo/listado/route.ts`), et `criterios.ts` s'annonce en tête comme le seul endroit
  // qui connaît le nom des paramètres, leur format et leur normalisation. La copie qui vivait ici
  // avait déjà perdu une de ces règles — la garde `personas >= 1` — sans qu'aucun test ne rougisse.
  //
  // Les trois paramètres restants ne sont PAS des critères : ils décrivent quelle page appelle le
  // pont, et n'ont donc rien à faire dans l'URL publique que `escribirCriterios` construit.
  const parametros = new URLSearchParams(escribirCriterios(criteriosDeConsulta).slice(1));
  parametros.set("tipo", tipo);
  parametros.set("locale", locale);
  if (categoria?.esSinTag) parametros.set("sinTag", "1");

  return (
    <PageShell variant="large">
      {/* ⚠️ Le JSON-LD est rendu ICI, côté serveur, et jamais dans `Migas` : règle SEO 6 du dépôt —
          le composant affiche, la route décrit. Les deux sont construits depuis LA MÊME liste
          `migas`, ce qui est la seule façon de garantir qu'ils ne divergent pas. */}
      <JsonLd
        // ⚠️ `migasParaJsonLd` et pas un `map` local : ces quatre lignes étaient recopiées ici, et
        // c'est cette copie même que l'extraction du 2026-09-08 devait supprimer — elle y avait
        // survécu. Le dernier élément n'a pas de `href` (c'est la page courante) ; le helper lui
        // donne la route canonique, celle-là même que `generateMetadata` déclare.
        data={buildBreadcrumbJsonLd(getSiteUrl(), migasParaJsonLd(migas, locale, rutaCanonica))}
      />

      <Migas items={migas} etiqueta={t("migasEtiqueta")} locale={locale} testId="migas" />

      {/* ⚠️ VISIBLE, contrairement au `<h1>` masqué de l'accueil (décision 5) : la règle « rien
          au-dessus du bloc de recherche » du cahier §2a ne vaut que pour l'accueil. Sur une page
          de listing, un titre masqué laisserait le visiteur deviner où il a atterri. */}
      <Title as="h1">{titulo}</Title>

      {/* ⚠️ Le texte de la catégorie, et c'est le SEUL contenu rédactionnel indexable de cette page
          (décision 7) : sans lui elle n'aurait que des cartes, comme des milliers d'autres. Absent
          sur les quatre listings, et absent d'une catégorie non encore rédigée — auquel cas le
          titre se suffit, et aucun bloc vide ne s'ouvre. */}
      {categoria?.descripcion ? (
        <p className="max-w-prose text-base text-muted" data-testid="categoria-descripcion">
          {categoria.descripcion}
        </p>
      ) : null}

      {/* ⚠️ `atajosTipo={[]}` : les raccourcis de type n'ont aucun sens ici — la page ne connaît
          qu'un type et n'a pas compté les autres. Un raccourci vers une section qu'elle n'a pas
          mesurée mènerait peut-être à une page vide, ce que la Tranche 2 de la spec 28 s'était
          justement interdit.
          ⚠️ Et ce composant navigue vers `/`, pas vers la page courante : c'est la décision 10 —
          le site n'a qu'UN écran de résultats. Aucune adaptation n'a été nécessaire, il poussait
          déjà vers l'accueil. */}
      <BuscadorInicio
        criteriosIniciales={criterios}
        aujourdIso={todayInBogota()}
        localeCodigo={locale}
        labels={labels}
        atajosTipo={[]}
      />

      {tarjetas.length === 0 ? (
        // Deux états vides distincts, et la différence compte pour le visiteur : « ta recherche ne
        // donne rien » n'est pas « cette section est encore vide ». Le second n'invite pas à
        // changer des critères qui n'existent pas.
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          testId="estado-vacio"
        />
      ) : (
        <ListadoInfinito
          tarjetasIniciales={tarjetas}
          total={total}
          hayMasInicial={hayMas}
          paginaInicial={pagina}
          endpointBase={`/api/catalogo/listado?${parametros.toString()}`}
          locale={locale}
        />
      )}
    </PageShell>
  );
}
