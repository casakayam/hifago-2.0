import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { ListadoTipo, metadataCategoria, resolverCategoria } from "../../ListadoTipo";

// `/[locale]/actividades/[categoria]` — LES OFFRES D'UNE CATÉGORIE (spec 29 §5b, généralisée
// 2026-09-14 : `resolverCategoria`/`metadataCategoria` vivent maintenant dans `ListadoTipo.tsx`,
// paramétrées par `tipo`, et ce fichier n'est plus que le patron répliqué pour les cinq types —
// voir `alojamientos/[categoria]/page.tsx` et les trois autres, copies littérales avec `tipo`
// changé. Renommé depuis `[tag]` pour cohérence avec les quatre nouvelles routes (cosmétique : le
// nom du segment n'apparaît pas dans l'URL).
//
// Sert aussi `/es/actividades/otras`, la page des activités qu'AUCUNE catégorie ne classe
// (décisions 1 et 2). Ce n'est pas un tag : `otras` est un slug RÉSERVÉ, interdit à `catalog_tags`
// par une contrainte SQL — sans quoi une catégorie portant ce nom masquerait cette page en silence.
//
// ⚠️ POURQUOI CETTE PAGE FAIT DEUX LECTURES, et pourquoi c'est le bon compte. La première
// (`resolverCategoria`, mémoïsée par `cache()`) demande les catégories AYANT UNE OFFRE ; c'est
// elle qui décide si la page existe. La seconde, dans `ListadoTipo`, demande les offres. On ne
// peut pas les fusionner : une catégorie qui existe en base mais ne porte plus rien doit rendre
// 404 (invariant 5), et une liste vide ne permet pas de distinguer « catégorie inconnue » de
// « catégorie vidée » — or les deux doivent rendre 404, tandis qu'une RECHERCHE sans résultat dans
// une catégorie vivante doit rendre 200.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/actividades/[categoria]">, "searchParams">
): Promise<Metadata> {
  const { locale, categoria: slug } = await props.params;
  const categoria = await resolverCategoria("activity", slug, locale as Locale);
  // Une page qui va rendre 404 ne mérite pas de métadonnées inventées : Next servira celles de
  // `not-found`.
  if (!categoria) return {};
  return metadataCategoria(categoria, "activity", locale as Locale);
}

export default async function CategoriaPage({
  params,
  searchParams,
}: PageProps<"/[locale]/actividades/[categoria]">) {
  const { locale, categoria: slug } = await params;
  setRequestLocale(locale);

  const categoria = await resolverCategoria("activity", slug, locale as Locale);

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
