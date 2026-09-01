import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, asLodgingKind, resolveLocalizedField } from "@hifago/domain";
import { EstablishmentDetailView } from "./EstablishmentDetailView";
import { routing } from "@/i18n/routing";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { buildEstablishmentJsonLd } from "@/lib/seo/jsonld/establishment";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { JsonLd } from "@/components/seo/JsonLd";

// T1 du modèle hébergement (spec 24 §4) — la page publique d'un établissement, qui n'existait pas.
//
// POURQUOI ELLE EST UN PRÉREQUIS. La cible retenue le 2026-08-26 supprime l'étage
// `products.type='hotel'` : chaque chambre devient un produit. Or la fiche produit « hôtel » est
// aujourd'hui le SEUL écran qui présente le lieu et regroupe ses chambres. La retirer sans cette
// page laisserait un catalogue de chambres orphelines, sans rien qui dise de quel hôtel elles
// viennent. On construit le remplaçant d'abord.
//
// ⚠️ Piège CLAUDE.md §11.16 : ce fichier est un Server Component et ne doit JAMAIS importer depuis
// "@hifago/ui" — le barrel tire app-nav-shell/lucide-react et fait planter `next build`, sur une
// erreur qui ne se voit ni au typecheck ni au lint. Tout le rendu vit dans
// EstablishmentDetailView.tsx ("use client").
//
// Template literal d'une seule ligne, sans interpolation : supabase-js infère le type de retour en
// analysant le TYPE LITTÉRAL de la chaîne (une concaténation l'élargirait en `string` et ferait
// tomber l'inférence sur GenericStringError). `lobby_api_token` n'est évidemment jamais sélectionné —
// il est revoke pour anon/authenticated, le demander ferait échouer TOUTE la requête.
// `lat, lon` ajoutés pour le nœud `geo` des données structurées : déjà accordés au rôle
// `anon` par la migration 20260819110000, donc aucune migration n'est nécessaire — mais une
// colonne non accordée ferait échouer TOUTE la requête avant même la RLS (CLAUDE.md §11.1).
const ESTABLISHMENT_COLUMNS = `id, slug, name, description, address, lat, lon, check_in_time, check_out_time, mode`;

const getEstablishment = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("establishments")
    .select(ESTABLISHMENT_COLUMNS)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  return data;
});

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/establishments/[slug]">, "searchParams">
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const establishment = await getEstablishment(slug);
  if (!establishment) return {};

  const title = resolveLocalizedField(asLocalizedField(establishment.name), locale) ?? slug;
  const description =
    resolveLocalizedField(asLocalizedField(establishment.description), locale) ?? undefined;

  // Même règle que la fiche produit (CLAUDE.md §5.3) : une page servie par REPLI JSONB, faute de
  // traduction réelle dans cette locale, reste noindex + canonical vers la langue source. Elle ne
  // doit jamais être indexée comme une page distincte — sinon on publie deux URL pour un contenu
  // identique, dans une langue que personne n'a écrite.
  //
  // ⚠️ Cette page ne portait PAS `alternates.languages`, contrairement à la fiche produit qui en
  // avait : incohérence réelle, contraire à §5.2, née d'avoir écrit deux fois la même règle à deux
  // endroits. Les deux passent désormais par buildPageMetadata.
  const nativeLocales = routing.locales.filter((candidate) =>
    hasNativeContent(establishment.name, candidate)
  );

  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/establishments/${slug}`,
    title,
    description,
    nativeLocales,
  });
}

export default async function EstablishmentPage({
  params,
}: PageProps<"/[locale]/establishments/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("EstablishmentPage");
  const tCommon = await getTranslations("Common");

  const establishment = await getEstablishment(slug);
  if (!establishment) notFound();

  const supabase = await createClient();

  // Deux lectures indépendantes (ni l'une ni l'autre ne dépend du résultat de la seconde, seulement
  // de l'id déjà connu) — en parallèle plutôt qu'en séquence, même raisonnement que la fiche produit.
  const [{ data: media }, { data: products }] = await Promise.all([
    supabase
      .from("establishment_media")
      .select("id, storage_path")
      .eq("establishment_id", establishment.id)
      .order("sort", { ascending: true }),
    supabase
      .from("products")
      .select("id, slug, name, description, type, price_cop, capacity, unit_count, lodging_kind")
      .eq("establishment_id", establishment.id)
      .eq("sellable", true)
      .order("created_at"),
  ]);

  const productIds = (products ?? []).map((p) => p.id);
  const { data: productMedia } =
    productIds.length > 0
      ? await supabase
          .from("product_media")
          .select("product_id, storage_path")
          .in("product_id", productIds)
          .order("sort", { ascending: true })
      : { data: [] };

  const firstMediaByProduct = new Map<string, string>();
  for (const row of productMedia ?? []) {
    if (!firstMediaByProduct.has(row.product_id)) {
      firstMediaByProduct.set(row.product_id, row.storage_path);
    }
  }

  const name = resolveLocalizedField(asLocalizedField(establishment.name), locale) ?? slug;
  const description = resolveLocalizedField(asLocalizedField(establishment.description), locale);

  const MAX_SNIPPET = 140;
  const catalog = (products ?? []).map((product) => {
    const rawDescription = resolveLocalizedField(asLocalizedField(product.description), locale);
    const storagePath = firstMediaByProduct.get(product.id);
    return {
      id: product.id,
      slug: product.slug,
      name: resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug,
      descriptionSnippet:
        rawDescription && rawDescription.length > MAX_SNIPPET
          ? `${rawDescription.slice(0, MAX_SNIPPET).trimEnd()}…`
          : (rawDescription ?? null),
      type: product.type as string,
      // asLodgingKind et non un cast : la colonne est typée `string | null` côté types générés,
      // et une valeur hors domaine chercherait une clé i18n inexistante à l'affichage.
      lodgingKind: asLodgingKind(product.lodging_kind),
      capacity: product.capacity,
      unitCount: product.unit_count,
      imageUrl: storagePath
        ? supabase.storage.from("catalog-media").getPublicUrl(storagePath).data.publicUrl
        : null,
    };
  });

  const siteUrl = getSiteUrl();
  const establishmentJsonLd = buildEstablishmentJsonLd({
    siteUrl,
    locale,
    slug,
    name,
    description,
    imageUrls: (media ?? []).map(
      (m) => supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl
    ),
    address: establishment.address,
    latitude: establishment.lat,
    longitude: establishment.lon,
    mode: establishment.mode,
    checkInTime: establishment.check_in_time,
    checkOutTime: establishment.check_out_time,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(siteUrl, [
    { name: tCommon("breadcrumbHome"), path: `/${locale}` },
    { name, path: `/${locale}/establishments/${slug}` },
  ]);

  return (
    <>
      <JsonLd data={establishmentJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <EstablishmentDetailView
        name={name}
        description={description ?? null}
        address={establishment.address}
        checkInTime={establishment.check_in_time}
        checkOutTime={establishment.check_out_time}
        mode={establishment.mode}
        photoSlides={(media ?? []).map((m) => ({
        id: m.id,
        alt: name,
        url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
        }))}
        products={catalog}
        backToCatalogLabel={t("backToCatalog")}
      />
    </>
  );
}
