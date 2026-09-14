import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { IndiceCategoriasConOfertas } from "../IndiceCategoriasConOfertas";
import { metadataListado } from "../ListadoTipo";

// `/[locale]/eventos` — l'index de catégories du type `evento` (généralisé 2026-09-14, spec 29
// §5c révisée). Volontairement MINCE : les cinq index ne diffèrent que par leur type, tout le
// reste vit dans `IndiceCategoriasConOfertas`.
//
// Elle n'appelle aucune requête Supabase et n'importe rien de `@hifago/ui` : les deux règles
// vérifiées par `scripts/check-data-layer.sh` (spec 27) sont tenues sans dérogation.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/eventos">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  return metadataListado("evento", locale as Locale);
}

export default async function EventosPage({ params, searchParams }: PageProps<"/[locale]/eventos">) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <IndiceCategoriasConOfertas tipo="evento" locale={locale as Locale} searchParams={await searchParams} />
  );
}
