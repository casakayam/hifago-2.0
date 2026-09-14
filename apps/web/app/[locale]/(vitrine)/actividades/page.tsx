import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { IndiceCategoriasConOfertas } from "../IndiceCategoriasConOfertas";
import { metadataListado } from "../ListadoTipo";

// `/[locale]/actividades` — l'index de catégories du type `activity` (généralisé 2026-09-14,
// spec 29 §5a révisée). Cette route était auparavant la SEULE avec des catégories, rendues comme
// de simples tuiles (image + nom, aucune offre) via `IndiceCategorias`/`TarjetaCategoria` — morts
// depuis ce lot. Elle réutilise maintenant le même corps partagé que les quatre autres types,
// `IndiceCategoriasConOfertas` : chaque catégorie montre un aperçu d'offres, comme une section de
// l'accueil.
//
// Elle n'appelle aucune requête Supabase et n'importe rien de `@hifago/ui` : les deux règles
// vérifiées par `scripts/check-data-layer.sh` (spec 27) sont tenues sans dérogation.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/actividades">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  return metadataListado("activity", locale as Locale);
}

export default async function ActividadesPage({ params, searchParams }: PageProps<"/[locale]/actividades">) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <IndiceCategoriasConOfertas tipo="activity" locale={locale as Locale} searchParams={await searchParams} />
  );
}
