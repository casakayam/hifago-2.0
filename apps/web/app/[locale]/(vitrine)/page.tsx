import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BarraNavegacion } from "@/components/organisms/BarraNavegacion";
import { SeccionOfertas } from "@/components/organisms/SeccionOfertas";
import { buscarSecciones, hrefSeccion } from "@/lib/catalog/buscar";
import { escribirCriterios, leerCriterios, leerDesdeCarrito } from "@/lib/catalog/criterios";
import { esTipoOferta, type TipoOferta } from "@/lib/catalog/tipos";
import { getCartLines } from "@/lib/cart/getCartLines";
import { buildWebSiteJsonLd } from "@/lib/seo/jsonld/site";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";
import { tiposDeBarra } from "./tiposDeBarra";

// L'ACCUEIL, QUI EST AUSSI L'ÉCRAN DE RÉSULTATS (spec 28, Tranche 1 — 2026-09-08).
//
// Le §2a du cahier client tranche les deux d'un coup : il n'y a pas de route `/buscar`, les
// critères vivent dans l'URL de CETTE page, et les résultats restent groupés par type d'offre.
// Une recherche ne change donc pas d'écran — elle change les paramètres de celui-ci.
//
// ⚠️ Ce fichier remplace un catalogue à plat qui faisait trois requêtes séquentielles et soixante
// lignes de regroupement ici même, puis filtrait EN MÉMOIRE côté client (`CatalogBrowser`,
// supprimé avec ce lot). Deux règles de la spec 27 en sont nées et sont vérifiées par la CI
// (`scripts/check-data-layer.sh`) : aucune requête Supabase dans un fichier de route, et aucun
// import de `@hifago/ui` — tout passe par `lib/catalog/`, et tout le HeroUI vit derrière une
// frontière `"use client"` (`TarjetaOferta` → `Card`/`PhotoStrip`).

/** Plafond par section, cahier §2a. Il vaut AUSSI sous recherche — sinon l'accueil filtrée
 *  devient une page à rallonge et se confond avec les pages de listing (spec 28 §8). */
const POR_SECCION = 8;

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "HomePage" });

  // La page la plus stratégique du site n'avait AUCUN generateMetadata : elle héritait du seul
  // `title: "Hifago"` du layout, alors que ces deux libellés existaient déjà dans messages/*.json
  // sans être utilisés nulle part.
  //
  // ⚠️ Le canonical auto-référent n'est pas décoratif ici : proxy.ts pose le cookie d'attribution
  // à partir de `?ref=` sur N'IMPORTE QUELLE page, et [locale]/r/[code]/route.ts redirige vers
  // `/<locale>?ref=<code>`. Chaque code promo distribué fabrique donc une URL indexable distincte
  // de l'accueil ; sans canonical, rien ne les rassemble. Depuis la spec 28 il rassemble aussi
  // toutes les variantes de recherche (`?q=`, `?personas=`…) — même mécanisme, sans une ligne de
  // plus : `pathFor` ignore les paramètres.
  //
  // Pas de `nativeLocales` : ces textes viennent de next-intl (jeu d'interface fermé et complet
  // dans les deux locales), pas du contenu partenaire soumis au repli JSONB.
  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}`,
    title: t("title"),
    description: t("description"),
  });
}

export default async function HomePage({ params, searchParams }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HomePage");
  const tCommon = await getTranslations("Common");

  // Les critères de l'URL sont les SEULS qui filtrent (spec 28 §0 invariant 10) : plus aucun
  // filtrage en mémoire. `leerCriterios` ne lève jamais — un paramètre invalide est ignoré, jamais
  // une 400 : une URL mal recopiée doit rendre l'accueil normale, pas une page cassée.
  const paramsBrutos = await searchParams;
  const criterios = leerCriterios(paramsBrutos);
  const sufijoCriterios = escribirCriterios(criterios);

  // Spec 28 Tranche 3 (cahier §2b.5) : le réordonnancement ne s'applique QUE juste après un ajout
  // au panier (décision Jérôme) — jamais à une simple visite de l'accueil. `desdeCarrito` porte ce
  // signal ; en son absence, `tiposEnCarrito` reste `undefined` et `buscarSecciones` se comporte
  // EXACTEMENT comme avant ce lot — zéro requête de plus.
  let tiposEnCarrito: ReadonlySet<TipoOferta> | undefined;
  if (leerDesdeCarrito(paramsBrutos)) {
    const lineas = await getCartLines(locale as Locale);
    tiposEnCarrito = new Set(lineas.map((linea) => linea.productType).filter(esTipoOferta));
  }

  // La requête PRINCIPALE de la page (plus `getCartLines` ci-dessus, seulement juste après un
  // ajout au panier) — ni l'une ni l'autre ne part d'ici : `lib/catalog/`/`lib/cart/` les portent,
  // jamais un `.from()`/`createClient()` dans ce fichier (spec 27 invariant 2). Les sections vides
  // ne sont pas dans le tableau rendu.
  const secciones = await buscarSecciones(criterios, {
    porSeccion: POR_SECCION,
    locale,
    tiposEnCarrito,
  });

  const labels = await labelsBuscador(locale as Locale);
  const tiposBarra = await tiposDeBarra(locale as Locale);

  return (
    <PageShell variant="large">
      {/* Nœud d'identité du site : c'est le plus rentable pour être cité par un moteur de
          réponse, et il n'exige aucune colonne de base de données. */}
      <JsonLd data={buildWebSiteJsonLd(getSiteUrl(), locale, t("title"), t("description"))} />

      {/* ⚠️ Masqué VISUELLEMENT, jamais retiré du DOM (spec 28 §5). Le cahier §2a ne veut rien
          au-dessus du bloc de recherche, mais une page sans `<h1>` est une faute d'accessibilité
          comme de référencement. `sr-only` n'est pas le `hidden md:block` interdit par
          `.claude/rules/ui.md` : le contenu reste indexé et lu par un lecteur d'écran.
          Jérôme a annoncé un bloc titré à cet endroit ; le jour où il existe, la seule chose à
          retirer est cette classe. */}
      <div className="sr-only">
        <Title as="h1">{t("h1")}</Title>
      </div>

      {/* Barre de navigation combinée (2026-09-14) : sur la home, un seul "Inicio" (page courante,
          pas de fil réel à afficher) accolé aux 5 onglets de type — validée en Storybook avant ce
          branchement (décision de Jérôme). Aucun tipoActivo : la home n'est le sujet d'aucun type
          précis. */}
      <BarraNavegacion
        migas={[{ nombre: tCommon("breadcrumbHome") }]}
        migasEtiqueta={t("migasEtiqueta")}
        locale={locale as Locale}
        tipos={tiposBarra}
        tiposEtiqueta={tCommon("selectorTipoEtiqueta")}
      />

      {/* ⚠️ Hôte CLIENT obligatoire : toutes les props de `SearchPanel` sont des fonctions, qu'un
          Server Component ne sait pas sérialiser. `aujourdIso` est calculé à Guatapé — jamais dans
          le fuseau du serveur (règle §11.20, vérifiée par scripts/check-timezone.sh). */}
      <BuscadorInicio
        criteriosIniciales={criterios}
        aujourdIso={todayInBogota()}
        localeCodigo={locale as Locale}
        labels={labels}
        // Les raccourcis proposés avant la première frappe. Ils sortent des sections déjà
        // calculées : aucune requête de plus, et ils décrivent le catalogue RÉELLEMENT servi —
        // un type absent des résultats n'apparaît pas comme raccourci vers une page vide.
        atajosTipo={secciones.map((seccion) => ({ tipo: seccion.tipo, total: seccion.total }))}
      />

      {secciones.length === 0 ? (
        // Un seul état vide global, jamais un « Aucune activité » répété cinq fois : sur une
        // recherche pointue, ce serait cinq lignes de bruit. La barre reste utilisable au-dessus.
        <EstadoVacio
          titulo={t("emptyState.titulo")}
          descripcion={t("emptyState.descripcion")}
          testId="estado-vacio"
        />
      ) : (
        secciones.map((seccion, indice) => (
          <SeccionOfertas
            key={seccion.tipo}
            titulo={t(`secciones.${seccion.tipo}`)}
            hrefVerMas={hrefSeccion(seccion.tipo, sufijoCriterios)}
            // ⚠️ Le « Ver más » des activités ne mène PAS à une liste d'offres mais à un index de
            // sous-catégories (`/es/actividades`, spec 29) : son libellé doit le dire, sinon le
            // lien promet une chose et en donne une autre.
            labelVerMas={seccion.tipo === "activity" ? t("verMasTags") : t("verMas")}
            variante={seccion.tipo === "activity" ? "lista" : "grilla"}
            tarjetas={seccion.tarjetas}
            locale={locale as Locale}
            // Une seule image de toute la page est prioritaire : la première carte de la première
            // section, c'est-à-dire le LCP. Toutes les autres restent en `lazy` — cinq sections de
            // huit cartes précharger ensemble, ce sont des dizaines de requêtes inutiles.
            prioridad={indice === 0}
            testId={`seccion-${seccion.tipo}`}
          />
        ))
      )}
    </PageShell>
  );
}
