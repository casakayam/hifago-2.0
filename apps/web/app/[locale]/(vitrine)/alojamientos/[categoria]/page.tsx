import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { ListadoTipo, metadataCategoria, resolverCategoria } from "../../ListadoTipo";

// `/[locale]/alojamientos/[categoria]` — LES OFFRES D'UNE CATÉGORIE (spec 29 §5b, généralisée
// 2026-09-14). Copie littérale du patron de `actividades/[categoria]/page.tsx` — `tipo` fixé,
// `resolverCategoria`/`metadataCategoria` importés depuis `ListadoTipo.tsx`, jamais réécrits.
//
// ⚠️ POURQUOI CETTE PAGE FAIT DEUX LECTURES, et pourquoi c'est le bon compte. La première
// (`resolverCategoria`, mémoïsée par `cache()`) demande les catégories AYANT UNE OFFRE ; c'est
// elle qui décide si la page existe. La seconde, dans `ListadoTipo`, demande les offres. On ne
// peut pas les fusionner : une catégorie qui existe en base mais ne porte plus rien doit rendre
// 404, et une liste vide ne permet pas de distinguer « catégorie inconnue » de « catégorie
// vidée » — or les deux doivent rendre 404, tandis qu'une RECHERCHE sans résultat dans une
// catégorie vivante doit rendre 200.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/alojamientos/[categoria]">, "searchParams">
): Promise<Metadata> {
  const { locale, categoria: slug } = await props.params;
  const categoria = await resolverCategoria("lodging", slug, locale as Locale);
  if (!categoria) return {};
  return metadataCategoria(categoria, "lodging", locale as Locale);
}

export default async function CategoriaPage({
  params,
  searchParams,
}: PageProps<"/[locale]/alojamientos/[categoria]">) {
  const { locale, categoria: slug } = await params;
  setRequestLocale(locale);

  const categoria = await resolverCategoria("lodging", slug, locale as Locale);

  // 404 dans TROIS cas : slug inconnu, catégorie vidée, ou « otras » alors que tout est classé —
  // à ne pas confondre avec une recherche sans résultat dans une catégorie vivante (200 + vide).
  if (!categoria) notFound();

  return (
    <ListadoTipo
      tipo="lodging"
      locale={locale as Locale}
      searchParams={await searchParams}
      categoria={categoria}
    />
  );
}
