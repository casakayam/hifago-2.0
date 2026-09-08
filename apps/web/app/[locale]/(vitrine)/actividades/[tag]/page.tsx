import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SLUG_SIN_TAG, listarTagsConOferta } from "@/lib/catalog/buscar";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { ListadoTipo, metadataCategoria, type CategoriaDeListado } from "../../ListadoTipo";

// `/[locale]/actividades/[tag]` — LES OFFRES D'UNE CATÉGORIE (spec 29 §5b).
//
// Elle sert aussi `/es/actividades/otras`, la page des activités qu'AUCUNE catégorie ne classe
// (décisions 1 et 2). Ce n'est pas un tag : `otras` est un slug RÉSERVÉ, interdit à `catalog_tags`
// par une contrainte SQL — sans quoi une catégorie portant ce nom masquerait cette page en silence.
//
// ⚠️ POURQUOI CETTE PAGE FAIT DEUX LECTURES, et pourquoi c'est le bon compte. La première demande
// les catégories AYANT UNE OFFRE ; c'est elle qui décide si la page existe. La seconde, dans
// `ListadoTipo`, demande les offres. On ne peut pas les fusionner : une catégorie qui existe en
// base mais ne porte plus rien doit rendre 404 (invariant 5), et une liste vide ne permet pas de
// distinguer « catégorie inconnue » de « catégorie vidée » — or les deux doivent rendre 404, tandis
// qu'une RECHERCHE sans résultat dans une catégorie vivante doit rendre 200.
//
// `cache()` déduplique la première entre `generateMetadata` et le composant — même motif que les
// deux fiches (`productos/[slug]`, `establecimientos/[slug]`).

const getCategorias = cache(async (locale: string) =>
  // ⚠️ SANS CRITÈRES, à dessein. « Cette catégorie existe-t-elle ? » ne dépend pas de la recherche
  // en cours : une catégorie vivante dont aucune offre ne correspond aux critères doit rendre 200
  // et un état vide, jamais un 404. Passer `criterios` ici ferait disparaître la page dès qu'un
  // filtre ne laisse rien — un lien partagé deviendrait mort selon les dates qu'il porte.
  listarTagsConOferta("activity", {}, { locale })
);

/** Résout le segment d'URL en catégorie affichable, `null` si la page ne doit pas exister. */
async function resolverCategoria(
  tag: string,
  locale: Locale
): Promise<CategoriaDeListado | null> {
  const categorias = await getCategorias(locale);
  const encontrada: CategoriaConOferta | undefined = categorias.find((c) => c.slug === tag);
  if (!encontrada) return null;

  if (encontrada.esSinTag) {
    // Ses libellés viennent de next-intl, jamais de la base : ce n'est pas une ligne de
    // `catalog_tags`. La couche de données les laisse vides à dessein (elle ne traduit rien).
    const t = await getTranslations({ locale, namespace: "ListadoPage" });
    return {
      slug: SLUG_SIN_TAG,
      nombre: t("sinTag.nombre"),
      descripcion: t("sinTag.descripcion"),
      esSinTag: true,
    };
  }

  return {
    slug: encontrada.slug,
    nombre: encontrada.nombre,
    descripcion: encontrada.descripcion,
    esSinTag: false,
  };
}

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/actividades/[tag]">, "searchParams">
): Promise<Metadata> {
  const { locale, tag } = await props.params;
  const categoria = await resolverCategoria(tag, locale as Locale);
  // Une page qui va rendre 404 ne mérite pas de métadonnées inventées : Next servira celles de
  // `not-found`.
  if (!categoria) return {};

  // ⚠️ `localesNativas` : le nom d'une catégorie est du CONTENU PARTENAIRE, pas de l'interface. Une
  // page servie en repli — nom espagnol sous `/en/` — reste `noindex` avec un canonical vers la
  // langue source (règle SEO 2), sinon Google indexe deux URL portant le même texte espagnol.
  // « Otras actividades » fait exception : ses libellés viennent de next-intl, la couche la déclare
  // donc native partout.
  const categorias = await getCategorias(locale);
  const nativas = categorias.find((c) => c.slug === tag)?.localesNativas;

  return metadataCategoria(categoria, locale as Locale, nativas);
}

export default async function CategoriaPage({
  params,
  searchParams,
}: PageProps<"/[locale]/actividades/[tag]">) {
  const { locale, tag } = await params;
  setRequestLocale(locale);

  const categoria = await resolverCategoria(tag, locale as Locale);

  // ⚠️ 404 dans TROIS cas, et c'est voulu dans les trois : le slug est inconnu, la catégorie existe
  // mais ne porte plus aucune offre publiée, ou « Otras » est demandée alors que tout est classé.
  // Le cahier §2a l'exige pour le deuxième — « un tag vide produirait une page vide que Google
  // indexerait » — et les trois se ressemblent trop pour être traités différemment : dans tous, la
  // page ne décrit rien.
  //
  // ⚠️ À ne PAS confondre avec une recherche sans résultat dans une catégorie vivante, qui rend 200
  // et un état vide : là, la page décrit quelque chose, c'est le filtre qui ne trouve rien.
  if (!categoria) notFound();

  return (
    <ListadoTipo
      tipo="activity"
      locale={locale as Locale}
      searchParams={await searchParams}
      categoria={categoria}
    />
  );
}
