import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { CatalogBrowser } from "./CatalogBrowser";

// products_select_public (Tranche 2, étendue feature 32) : catalogue public, sellable=true
// seulement. La recherche/le filtre restent volontairement basiques (texte + type, en mémoire
// côté client, cf. CatalogBrowser.tsx) — pas de recherche géo/tags (cible différée, cf.
// docs/01-cahier-des-charges-client.md §2). Piège CLAUDE.md §11.16 : ce fichier (Server
// Component) ne doit JAMAIS importer quoi que ce soit depuis "@hifago/ui" (le barrel tire
// app-nav-shell/lucide-react et fait planter next build) — tout le rendu HeroUI vit dans
// CatalogBrowser.tsx ("use client").
const PRODUCTS_COLUMNS = "id, slug, name, description, type";

export default async function HomePage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HomePage");

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select(PRODUCTS_COLUMNS)
    .eq("sellable", true)
    .order("created_at");

  const productIds = (products ?? []).map((p) => p.id);
  const { data: media } =
    productIds.length > 0
      ? await supabase
          .from("product_media")
          .select("product_id, storage_path, sort")
          .in("product_id", productIds)
          .order("sort", { ascending: true })
      : { data: [] };

  // Première photo par produit seulement (déjà triée par sort) — une carte n'a besoin que d'une
  // vignette, pas de la galerie complète (celle-ci vit sur la fiche produit, ProductPhotos.tsx).
  const firstMediaByProduct = new Map<string, string>();
  for (const row of media ?? []) {
    if (!firstMediaByProduct.has(row.product_id)) {
      firstMediaByProduct.set(row.product_id, row.storage_path);
    }
  }

  const MAX_DESCRIPTION_LENGTH = 140;
  const catalog = (products ?? []).map((product) => {
    const name = resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug;
    const rawDescription = resolveLocalizedField(asLocalizedField(product.description), locale);
    const descriptionSnippet =
      rawDescription && rawDescription.length > MAX_DESCRIPTION_LENGTH
        ? `${rawDescription.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}…`
        : rawDescription;
    const storagePath = firstMediaByProduct.get(product.id);
    const imageUrl = storagePath
      ? supabase.storage.from("catalog-media").getPublicUrl(storagePath).data.publicUrl
      : null;

    return {
      id: product.id,
      slug: product.slug,
      name,
      descriptionSnippet: descriptionSnippet ?? null,
      type: product.type as string,
      imageUrl,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("description")}</p>
      </div>

      <CatalogBrowser products={catalog} />
    </main>
  );
}
