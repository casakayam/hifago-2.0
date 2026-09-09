import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { todayInBogota } from "@hifago/domain";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { Migas } from "@/components/molecules/Migas";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { IndiceCategorias } from "@/components/organisms/IndiceCategorias";
import { listarTagsConOferta } from "@/lib/catalog/buscar";
import { hayCriterios, leerCriterios } from "@/lib/catalog/criterios";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { migasParaJsonLd } from "@/lib/seo/migas";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import type { Locale } from "@/messages";
import { BuscadorInicio } from "../BuscadorInicio";
import { metadataListado } from "../ListadoTipo";
import { labelsBuscador } from "../labelsBuscador";

// `/[locale]/actividades` — L'INDEX DE CATÉGORIES (spec 29 §5a, décisions 3 à 8).
//
// ⚠️ CET ÉCRAN NE LISTE AUCUNE OFFRE, et c'est la seule des six routes dans ce cas. Le cahier §2a
// le tranche : « la page des activités est un index de sous-catégories (les tags : jet ski, buceo,
// kayak…), sans produit ; on y clique pour atteindre la liste des offres d'un tag ». C'est aussi
// pourquoi le « Ver más » de la section activités de l'accueil porte un libellé DIFFÉRENT des
// quatre autres (`verMasTags`) : le lien promettrait sinon une chose et en donnerait une autre.
//
// ⚠️ Il n'a donc PAS de `ListadoTipo` : ni défilement, ni pont, ni `?pagina=`. Le nombre de
// catégories d'un catalogue se compte en dizaines, jamais en centaines.
//
// ⚠️ Il respecte les critères de recherche (décision 3) : une catégorie n'apparaît que si elle
// porte au moins une offre qui y répond, et chaque tuile les emporte vers sa liste. C'est ce qui
// garantit qu'une tuile ne mène JAMAIS à une page vide — la même règle qui fait disparaître un tag
// sans offre (cahier §2a : « un tag vide produirait une page vide que Google indexerait »).

// ⚠️ `metadataListado` et pas une copie : ces dix-sept lignes reproduisaient exactement son corps
// pour `activity` (`segmentoDeTipo("activity")` vaut « actividades », et `libelles` lit la même clé
// `secciones.activity`). La copie avait déjà perdu la note qui compte — celle qui explique que
// `pathFor` ne reçoit AUCUN paramètre, donc que le canonical ignore `?pagina=`. Un paramètre ajouté
// demain au canonical des listings n'aurait pas suivi ici, et l'index aurait fabriqué des URL
// indexables que ses propres pages déclarent canoniques ailleurs.
export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/actividades">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  return metadataListado("activity", locale as Locale);
}

export default async function ActividadesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/actividades">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });
  const t = await getTranslations({ locale, namespace: "ListadoPage" });

  const criterios = leerCriterios(await searchParams);

  // LA seule requête de la page, et elle ne part pas d'ici : `lib/catalog/` la porte. Elle rend les
  // catégories DÉJÀ triées (`Intl.Collator` de la locale) et « Otras actividades » en dernier.
  const categorias = await listarTagsConOferta("activity", criterios, { locale });

  const seccion = tHome("secciones.activity");
  const libellesSinTag = {
    // ⚠️ Ces deux libellés viennent d'ICI et pas de la base : « Otras actividades » n'est pas une
    // ligne de `catalog_tags`, c'est ce qui reste quand aucune catégorie ne classe une offre. La
    // couche de données rend `esSinTag: true` et laisse les libellés vides — elle ne traduit rien.
    nombre: t("sinTag.nombre"),
    descripcion: t("sinTag.descripcion"),
  };

  const labels = await labelsBuscador(locale as Locale);

  // ⚠️ UNE liste, lue deux fois. Elle était écrite DEUX fois — un littéral pour le JSON-LD, un
  // autre pour le fil visible — sous un commentaire qui affirmait déjà « ils sortent de la même
  // liste ». Ajouter un niveau à l'une seulement passait typecheck, lint et toute la suite.
  const migas = [{ nombre: tCommon("breadcrumbHome"), href: "/" }, { nombre: seccion }];

  return (
    <PageShell variant="large">
      {/* Règle SEO 6 : le JSON-LD est rendu côté serveur par la route, jamais par `Migas`. Les deux
          décrivent la même chose parce qu'ils sortent — vraiment — de la même liste. */}
      <JsonLd
        data={buildBreadcrumbJsonLd(
          getSiteUrl(),
          migasParaJsonLd(migas, locale, "/actividades")
        )}
      />

      <Migas
        items={migas}
        etiqueta={t("migasEtiqueta")}
        locale={locale as Locale}
        testId="migas"
      />

      {/* VISIBLE (décision 5) — contrairement au `<h1>` masqué de l'accueil. */}
      <Title as="h1">{seccion}</Title>

      {/* ⚠️ `atajosTipo={[]}` : la page ne connaît qu'un type et n'a compté aucun autre. Et ce
          composant navigue vers `/` — décision 10, le site n'a qu'UN écran de résultats. */}
      <BuscadorInicio
        criteriosIniciales={criterios}
        aujourdIso={todayInBogota()}
        localeCodigo={locale as Locale}
        labels={labels}
        atajosTipo={[]}
      />

      {categorias.length === 0 ? (
        // Deux états vides distincts : « ta recherche ne donne rien » n'est pas « il n'y a pas
        // encore d'activités ». Le second n'invite pas à changer des critères qui n'existent pas.
        <EstadoVacio
          titulo={hayCriterios(criterios) ? t("emptyState.titulo") : t("sinOfertas.titulo")}
          descripcion={
            hayCriterios(criterios) ? t("emptyState.descripcion") : t("sinOfertas.descripcion")
          }
          testId="estado-vacio"
        />
      ) : (
        <IndiceCategorias
          categorias={categorias}
          libellesSinTag={libellesSinTag}
          testId="indice-categorias"
        />
      )}
    </PageShell>
  );
}
