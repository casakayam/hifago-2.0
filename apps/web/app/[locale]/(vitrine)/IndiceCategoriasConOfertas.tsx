import { getTranslations } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { BarraNavegacion } from "@/components/organisms/BarraNavegacion";
import { SeccionOfertas } from "@/components/organisms/SeccionOfertas";
import { buscarCategorias, hrefCategoria } from "@/lib/catalog/buscar";
import {
  escribirCriterios,
  hayCriterios,
  leerCriterios,
  type ParamsBrutos,
} from "@/lib/catalog/criterios";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import type { TipoOferta } from "@/lib/catalog/tipos";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasParaJsonLd } from "@/lib/seo/migas";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "./BuscadorInicio";
import { labelsBuscador } from "./labelsBuscador";
import { tiposDeBarra } from "./tiposDeBarra";

// L'INDEX DE CATÉGORIES D'UN TYPE (généralisé 2026-09-14 — remplace, pour les cinq types, deux
// écrans distincts : les quatre listings plats (`ListadoTipo` sans `categoria`) et l'ancien index
// de tuiles vides `/actividades` (`IndiceCategorias`/`TarjetaCategoria`, désormais morts).
//
// ⚠️ POURQUOI UN FICHIER PARTAGÉ COLOCALISÉ, PAS UN COMPOSANT DE `components/`. Même raison que
// `ListadoTipo.tsx`, à côté duquel il vit : il appelle `lib/catalog/` (réservé au serveur) et
// traduit — un `page.tsx` n'importe donc AUCUNE requête ici non plus (`scripts/check-data-layer.sh`).
//
// ⚠️ CHAQUE CATÉGORIE EST UNE SECTION « COMME L'ACCUEIL » — littéralement le même composant,
// `SeccionOfertas` : un titre, une grille/liste de `POR_CATEGORIA` cartes, un « Ver más » qui ne
// se rend QUE si la catégorie a plus d'offres que celles montrées (`mostrarVerMas`). C'est la
// différence avec l'accueil, qui rend son « Ver más » inconditionnellement — une section de
// l'accueil a TOUJOURS plus d'offres du type qu'elle n'en montre, une catégorie pas forcément.
const POR_CATEGORIA = 6;

/**
 * Le fil d'Ariane et le titre partagent la même source que les listings (`ListadoTipo.tsx`).
 *
 * ⚠️ `verMas` vient de `HomePage`, PAS de `ListadoPage` : c'est le MÊME libellé que le « Ver más »
 * d'une section de l'accueil (`page.tsx`), pas un texte propre à cet écran — `ListadoPage.json` ne
 * porte que des libellés spécifiques au listing (état vide, pagination). Une seconde clé au même
 * texte aurait divergé à la première retouche.
 */
async function libelles(tipo: TipoOferta, locale: Locale) {
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  return {
    seccion: tHome(`secciones.${tipo}`),
    verMas: tHome("verMas"),
    inicio: tCommon("breadcrumbHome"),
    tiposEtiqueta: tCommon("selectorTipoEtiqueta"),
  };
}

export async function IndiceCategoriasConOfertas({
  tipo,
  locale,
  searchParams,
}: {
  tipo: TipoOferta;
  locale: Locale;
  searchParams: ParamsBrutos;
}) {
  const t = await getTranslations({ locale, namespace: "ListadoPage" });
  const { seccion, verMas, inicio, tiposEtiqueta } = await libelles(tipo, locale);

  const criterios = leerCriterios(searchParams);
  const sufijoCriterios = escribirCriterios(criterios);

  // LA seule requête de la page, et elle ne part pas d'ici : `lib/catalog/` la porte. Elle rend
  // les catégories DÉJÀ triées (`Intl.Collator` de la locale), chacune avec ses offres plafonnées
  // à `POR_CATEGORIA`, et la catégorie de rattrapage toujours en dernier.
  const categorias = await buscarCategorias(tipo, criterios, { porCategoria: POR_CATEGORIA, locale });

  const migas = [{ nombre: inicio, href: "/" }, { nombre: seccion }];

  const labels = await labelsBuscador(locale);

  return (
    <PageShell variant="large">
      {/* Règle SEO 6 : le JSON-LD est rendu côté serveur par la route, jamais par `Migas`. */}
      <JsonLd
        data={buildBreadcrumbJsonLd(
          getSiteUrl(),
          migasParaJsonLd(migas, locale, `/${segmentoDeTipo(tipo)}`)
        )}
      />

      <BarraNavegacion
        migas={migas}
        migasEtiqueta={t("migasEtiqueta")}
        locale={locale}
        tipos={await tiposDeBarra(locale)}
        tipoActivo={tipo}
        tiposEtiqueta={tiposEtiqueta}
      />

      {/* VISIBLE, contrairement au `<h1>` masqué de l'accueil (décision 5, spec 29) : un titre
          masqué laisserait le visiteur deviner où il a atterri. */}
      <Title as="h1">{seccion}</Title>

      {/* ⚠️ `atajosTipo={[]}` : la page ne connaît qu'un type et n'a compté aucun autre. Ce
          composant navigue vers `/`, pas vers la page courante — décision 10, le site n'a qu'UN
          écran de résultats. */}
      <BuscadorInicio
        criteriosIniciales={criterios}
        aujourdIso={todayInBogota()}
        localeCodigo={locale}
        labels={labels}
        atajosTipo={[]}
      />

      {categorias.length === 0 ? (
        // Deux états vides distincts : « ta recherche ne donne rien » n'est pas « il n'y a pas
        // encore d'offres ». Le second n'invite pas à changer des critères qui n'existent pas.
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          testId="estado-vacio"
        />
      ) : (
        categorias.map((categoria, indice) => (
          <SeccionOfertas
            key={categoria.slug}
            titulo={categoria.nombre}
            tituloAs="h2"
            hrefVerMas={hrefCategoria(tipo, categoria.slug, sufijoCriterios)}
            labelVerMas={verMas}
            // ⚠️ Toutes les sections en grille (2026-09-14, retour explicite de Jérôme) — cf.
            // `page.tsx` pour le raisonnement complet : les activités utilisaient `variante="lista"`
            // par choix esthétique de Jérôme (spec 28 §5), jamais une contrainte fonctionnelle,
            // avec un défaut visuel non résolu (spec 28 §10bis). Cohérent avec toutes les autres
            // catégories, qui étaient déjà en grille.
            variante="grilla"
            tarjetas={categoria.tarjetas}
            locale={locale}
            prioridad={indice === 0}
            mostrarVerMas={categoria.total > categoria.tarjetas.length}
            testId={`categoria-${categoria.slug}`}
          />
        ))
      )}
    </PageShell>
  );
}
