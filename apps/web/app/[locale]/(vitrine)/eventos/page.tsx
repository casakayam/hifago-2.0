import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/messages";
import { ListadoTipo, metadataListado } from "../ListadoTipo";

// `/[locale]/eventos` — le listing des offres de type `evento` (spec 29 §5c).
//
// ⚠️ Cette page est volontairement MINCE : les quatre listings ne diffèrent que par leur type, et
// tout le reste — la requête, le fil d'Ariane, le titre, le bloc de recherche, l'état vide, le
// défilement — vit dans `ListadoTipo`. Y ajouter quoi que ce soit ici, c'est l'ajouter à un seul
// des quatre écrans.
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
    <ListadoTipo tipo="evento" locale={locale as Locale} searchParams={await searchParams} />
  );
}
