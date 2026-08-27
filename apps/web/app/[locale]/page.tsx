import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { CatalogBrowser, type CatalogProduct } from "./CatalogBrowser";

// products_select_public (Tranche 2, étendue feature 32) : catalogue public, sellable=true
// seulement. La recherche/le filtre restent volontairement basiques (texte + type, en mémoire
// côté client, cf. CatalogBrowser.tsx) — pas de recherche géo/tags (cible différée, cf.
// docs/01-cahier-des-charges-client.md §2). Piège CLAUDE.md §11.16 : ce fichier (Server
// Component) ne doit JAMAIS importer quoi que ce soit depuis "@hifago/ui" (le barrel tire
// app-nav-shell/lucide-react et fait planter next build) — tout le rendu HeroUI vit dans
// CatalogBrowser.tsx ("use client").
const PRODUCTS_COLUMNS = "id, slug, name, description, type, establishment_id";

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

  // T1/T3 (spec 24 §4) — REGROUPEMENT DES LOGEMENTS PAR ÉTABLISSEMENT.
  //
  // Le catalogue listait chaque produit à plat. Or les chambres SONT déjà des produits pour un
  // hébergement adossé à LobbyPMS — Casa Kayam a six catégories — donc un seul hôtel occupait six
  // cartes de la page d'accueil et noyait tout le reste. La spec 24 présentait ce travers comme une
  // CONDITION de T3 (« un hôtel à 12 types produit 12 cartes ») ; en réalité il ne dépend pas du
  // retrait de l'étage `hotel` : il existe aujourd'hui, et T1 vient de donner la destination qui
  // manquait pour le régler.
  //
  // RÈGLE : on ne groupe qu'à partir de DEUX logements vendables sur le même établissement. Grouper
  // une cabaña isolée ajouterait un clic vers une page qui n'aurait qu'elle à montrer.
  //
  // Les non-logements ne sont JAMAIS groupés : deux kayaks du même prestataire sont deux offres
  // distinctes, alors que deux chambres du même hôtel sont deux façons de dormir au même endroit.
  const establishmentIds = [
    ...new Set(
      (products ?? []).map((p) => p.establishment_id).filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: establishments } =
    establishmentIds.length > 0
      ? await supabase
          .from("establishments")
          // `status` : sans lui, un établissement archivé garde une carte groupée dans le catalogue
          // alors que sa page publique répond 404 (elle filtre, elle, sur status='active'). Un
          // établissement non résolu ici retombe simplement sur des cartes produit individuelles.
          .select("id, slug, name, description")
          .eq("status", "active")
          .in("id", establishmentIds)
      : { data: [] };
  const establishmentById = new Map((establishments ?? []).map((e) => [e.id, e]));

  const lodgingCountByEstablishment = new Map<string, number>();
  for (const product of products ?? []) {
    if (product.type !== "lodging" || !product.establishment_id) continue;
    const current = lodgingCountByEstablishment.get(product.establishment_id) ?? 0;
    lodgingCountByEstablishment.set(product.establishment_id, current + 1);
  }

  const MAX_DESCRIPTION_LENGTH = 140;
  const snippet = (value: string | null): string | null =>
    value && value.length > MAX_DESCRIPTION_LENGTH
      ? `${value.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}…`
      : value;

  const catalog: CatalogProduct[] = [];
  const groupedEstablishments = new Set<string>();

  for (const product of products ?? []) {
    const establishmentId = product.establishment_id;
    const lodgingCount = establishmentId ? (lodgingCountByEstablishment.get(establishmentId) ?? 0) : 0;
    const establishment = establishmentId ? establishmentById.get(establishmentId) : undefined;
    const storagePath = firstMediaByProduct.get(product.id);
    const imageUrl = storagePath
      ? supabase.storage.from("catalog-media").getPublicUrl(storagePath).data.publicUrl
      : null;

    if (product.type === "lodging" && establishmentId && lodgingCount >= 2 && establishment?.slug) {
      // Une carte par établissement : les logements suivants du même lieu sont absorbés. L'image et
      // la position viennent du PREMIER (la requête est triée par created_at), ce qui rend l'ordre
      // stable d'un rendu à l'autre plutôt que dépendant du hasard de la jointure.
      if (groupedEstablishments.has(establishmentId)) continue;
      groupedEstablishments.add(establishmentId);

      catalog.push({
        id: `establishment-${establishmentId}`,
        href: `/establishments/${establishment.slug}`,
        testId: `catalog-link-establishment-${establishment.slug}`,
        name: resolveLocalizedField(asLocalizedField(establishment.name), locale) ?? establishment.slug,
        descriptionSnippet: snippet(
          resolveLocalizedField(asLocalizedField(establishment.description), locale) ?? null
        ),
        type: "lodging",
        subtitle: t("lodgingCount", { count: lodgingCount }),
        imageUrl,
      });
      continue;
    }

    catalog.push({
      id: product.id,
      href: `/products/${product.slug}`,
      testId: `catalog-link-${product.slug}`,
      name: resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug,
      descriptionSnippet: snippet(
        resolveLocalizedField(asLocalizedField(product.description), locale) ?? null
      ),
      type: product.type as string,
      subtitle: null,
      imageUrl,
    });
  }

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
