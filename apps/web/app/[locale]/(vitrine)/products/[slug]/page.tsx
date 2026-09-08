import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import {
  lastBookableDateIso,
  asLocalizedField,
  asLodgingKind,
  isPmsBacked,
  resolveLocalizedField,
  todayInBogota,
} from "@hifago/domain";
import { formatOccurrenceLabel } from "@/lib/products/formatOccurrenceLabel";
import { formatCop } from "@hifago/domain";
import { ProductDetailView } from "./ProductDetailView";
import { routing } from "@/i18n/routing";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { buildProductJsonLd } from "@/lib/seo/jsonld/product";
import { buildBreadcrumbJsonLd } from "@/lib/seo/jsonld/breadcrumb";
import { JsonLd } from "@/components/seo/JsonLd";

// Template literal sans interpolation (pas une concaténation "a" + "b"), une seule ligne : Supabase-js
// infère le type de retour de .select() en analysant le TYPE littéral de la chaîne au niveau
// TypeScript — une concaténation par + l'élargirait en simple `string`, perdant l'info nécessaire
// au parsing statique (constaté : tombe alors sur le type de repli GenericStringError). Une seule
// ligne, aussi, pour ne pas envoyer de retours à la ligne dans le paramètre select de PostgREST.
// establishment(description, address) : feature 32, jamais photo_urls (colonne absente du GRANT
// SELECT public — supabase/migrations/20260819110000_pms_connector_schema.sql — la sélectionner
// ferait échouer toute la requête). Photo d'établissement : establishment_media (public, RLS
// héritée), requêtée séparément ci-dessous comme product_media l'est déjà pour les produits.
// lobby_category_id : spec 21 §13 (gap comblé) — jamais revoke côté products (contrairement à
// establishments.lobby_api_token), sert uniquement à dériver isPmsBacked ci-dessous.
// capacity/quantity ajoutés le 2026-08-26 : ils étaient écrits en base (et, pour un logement lié,
// importés depuis LobbyPMS) mais ABSENTS de ce select — donc lus par aucun écran public, exactement
// comme `unit`. Une chambre affichait son prix sans jamais dire pour combien de personnes.
const PRODUCT_COLUMNS = `id, slug, name, description, price_cop, price_tiers, min_qty, max_qty, unit, capacity, unit_count, lodging_kind, type, price_label, external_booking_url, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, lobby_category_id, establishment:establishments(id, slug, name, description, address)`;

const getProduct = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  return product;
});

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/products/[slug]">, "searchParams">
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const product = await getProduct(slug);
  if (!product) return {};

  const title = resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug;
  const description =
    resolveLocalizedField(asLocalizedField(product.description), locale) ?? undefined;

  // Une fiche saisie sans traduction pour cette locale (repli JSONB, cf. hifago/CLAUDE.md §5)
  // reste noindex + canonical vers la langue source, et ne s'annonce pas comme une version
  // linguistique distincte. Ces trois décisions se prennent ENSEMBLE : elles vivent donc dans
  // buildPageMetadata, partagé avec l'accueil et la page établissement — et le prédicat
  // hasNativeContent est le même que celui du sitemap, sans quoi celui-ci listerait des URL que
  // ces métadonnées déclarent noindex.
  const nativeLocales = routing.locales.filter((candidate) =>
    hasNativeContent(product.name, candidate)
  );

  return buildPageMetadata({
    locale,
    pathFor: (candidate) => `/${candidate}/products/${product.slug}`,
    title,
    description,
    nativeLocales,
  });
}

export default async function ProductPage({
  params,
}: PageProps<"/[locale]/products/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  // Le rendu JSX vit désormais dans ProductDetailView.tsx ("use client"), qui appelle
  // useTranslations lui-même — une fonction traducteur next-intl obtenue côté serveur
  // (getTranslations) n'est pas sérialisable à travers la frontière Server → Client Component.
  // `tOccurrence` reste nécessaire ICI uniquement pour composer occurrenceLabel, une chaîne déjà
  // finalisée avant d'être passée en prop. `t` ne l'est plus depuis le retrait de l'étage hôtel
  // (T3, 2026-08-27) : il ne servait qu'au « Desde {prix le plus bas} » d'un hôtel, dont le prix
  // vivait sur ses chambres.
  const tOccurrence = await getTranslations("ProductPage.occurrence");
  const tCommon = await getTranslations("Common");

  const supabase = await createClient();
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  // Feature 21 : un evento vitrine n'a ni cupo ni panier — la disponibilité n'a aucun sens pour ce
  // type, jamais consultée (contrairement aux autres types, réservables via create_order).
  const isEvento = product.type === "evento";
  // Spec 17 §0 Tranche 2 : un alojamiento se réserve par plage de nuits (check-in/check-out), pas
  // par date unique — écran dédié (LodgingReservationForm), jamais le ReservationForm générique.
  const isLodging = product.type === "lodging";
  // Spec 21 §13 (gap comblé) : un alojamiento PMS-backed (Casa Kayam) n'a jamais de
  // product_availability/product_date_rates peuplées (Lobby fait foi, jamais dupliqué en base) —
  // LodgingReservationForm.tsx bascule sur un fetch client dédié (/api/pms/night-availability)
  // quand ce flag est vrai, au lieu de la prop `availability` SSR ci-dessous (toujours vide pour ce
  // cas, conservée telle quelle par cohérence avec le reste du fichier plutôt que retirée).
  const productIsPmsBacked = isPmsBacked({ type: product.type, lobbyCategoryId: product.lobby_category_id });
  // Ces 3 flags dérivés de product.type (connu synchronement dès getProduct() ci-dessus) restent
  // nécessaires en l'état : ils gardent les requêtes ci-dessous, exécutées en parallèle (Promise.all)
  // AVANT de savoir si le produit est à créneaux (slotRulesCount, résultat du Promise.all) — le
  // reservationMode qui les unifie tous les deux (cf. plus bas) ne peut donc être résolu qu'après.

  // « Aujourd'hui » = le jour civil à GUATAPÉ, jamais celui d'UTC (lot fuseau, 2026-08-28). Cette
  // page est un Server Component : elle s'exécutait sur un serveur Vercel réglé en UTC, donc passé
  // 19 h heure locale `todayIso` désignait déjà DEMAIN — et les trois `gte("date", todayIso)`
  // ci-dessous retiraient du catalogue les créneaux et les tarifs de la soirée en cours.
  //
  // todayIso est dérivé une seule fois ici et réutilisé aux 4 sites qui en ont besoin ci-dessous
  // (get_product_slots p_from, et les gte("date", …) sur product_availability/product_date_rates).
  // La fenêtre +180 j des créneaux (plus bas) part de la même date mais reste un calcul séparé :
  // ce n'est pas le même cutoff.
  const todayIso = todayInBogota();

  // availability/slotRulesCount/roomTypesRaw/productDateRates/media ne dépendent QUE de
  // product.type/product.id (connus synchronement dès getProduct() ci-dessus) — aucune dépendance
  // entre elles, un seul aller-retour réseau groupé plutôt que 5 attentes séquentielles. Un helper
  // par requête (plutôt qu'un ternaire direct dans le tableau du Promise.all) : TypeScript infère
  // ainsi le type de retour exactement comme l'ancien `cond ? { data: [] } : await supabase...`
  // ligne par ligne, sans annotation manuelle — et l'appel de chaque helper démarre sa requête tout
  // de suite (même tick), donc en vrai parallèle malgré l'`await` interne à chacun. Les vrais
  // enchaînements dépendants restent APRÈS ce Promise.all : productSlots (a besoin du résultat de
  // slotRulesCount/isSlotBased ci-dessous) et roomAvailability/roomRates (déjà groupés eux-mêmes,
  // slotRulesCount/isSlotBased ci-dessous).
  const fetchAvailability = async () =>
    isEvento
      ? { data: [] }
      : await supabase
          .from("product_availability")
          .select("date, capacity, booked")
          .eq("product_id", product.id)
          .order("date");

  // Spec 18 §0 Tranche 1 : un produit à créneaux horaires (jetski, etc.) a au moins une ligne
  // product_slot_rules côté admin — capacité par (date, heure), jamais par date seule
  // (product_availability n'a aucun sens pour lui, cf. hifago/CLAUDE.md §11 entrée 2026-08-18).
  // Requête gardée par un conditionnel VOLONTAIREMENT différent de celui d'availability ci-dessus
  // (isLodging en plus ici) : un alojamiento a toujours son propre écran dédié quel que soit le
  // nombre de règles de créneaux qu'il pourrait avoir (reservationMode plus bas le confirme,
  // "lodging" gagne avant même de regarder "slot") — leur compter des règles de créneaux serait une
  // requête gaspillée. (Un commentaire précédent affirmait à tort "même conditionnel que
  // availability" — la divergence documentée ici est le comportement correct, pas un bug.)
  const fetchSlotRulesCount = async () =>
    isEvento || isLodging
      ? { count: 0 }
      : await supabase
          .from("product_slot_rules")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id);

  // Spec 17 §0 Tranche 2 : override de prix par nuit pour un alojamiento, sur product_id.
  const fetchProductDateRates = async () =>
    isLodging
      ? await supabase
          .from("product_date_rates")
          .select("date, price_cop")
          .eq("product_id", product.id)
          .gte("date", todayIso)
      : { data: [] };

  const [
    { data: availability },
    { count: slotRulesCount },
    { data: productDateRates },
    { data: media },
    { data: establishmentMedia },
  ] = await Promise.all([
    fetchAvailability(),
    fetchSlotRulesCount(),
    fetchProductDateRates(),
    supabase
      .from("product_media")
      .select("id, storage_path")
      .eq("product_id", product.id)
      .order("sort", { ascending: true }),
    supabase
      .from("establishment_media")
      .select("id, storage_path")
      .eq("establishment_id", product.establishment?.id ?? "")
      .order("sort", { ascending: true }),
  ]);

  const isSlotBased = (slotRulesCount ?? 0) > 0;
  // Résolu une seule fois ici (dépend de product.type ET de isSlotBased, donc pas avant ce point,
  // cf. commentaire plus haut) — consommé partout ensuite (fetch dépendant de productSlots,
  // priceDisplay, tout le rendu ci-dessous) au lieu de recomposer isEvento/isHotel/isLodging/
  // isSlotBased à chaque site. Ordre de priorité identique à l'ancien enchaînement de ternaires du
  // rendu (evento > lodging > slot > date), préservé à l'identique.
  const reservationMode: "evento" | "lodging" | "slot" | "date" = isEvento
    ? "evento"
    : isLodging
      ? "lodging"
      : isSlotBased
        ? "slot"
          : "date";

  const { data: productSlots } =
    reservationMode === "slot"
      ? await supabase.rpc("get_product_slots", {
          p_product_id: product.id,
          p_from: todayIso,
          p_to: lastBookableDateIso(todayIso),
        })
      : { data: [] };

  const name = resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug;
  const description = resolveLocalizedField(asLocalizedField(product.description), locale);
  const establishmentName =
    resolveLocalizedField(asLocalizedField(product.establishment?.name), locale) ?? "";
  const establishmentDescription = resolveLocalizedField(
    asLocalizedField(product.establishment?.description),
    locale
  );
  const establishmentAddress = product.establishment?.address ?? null;

  // price_label affiché tel quel pour un evento (texte libre, admin §3c) — jamais formaté en COP,
  // à la différence de price_cop pour tous les autres types.
  const priceDisplay =
    reservationMode === "evento"
      ? product.price_label
      : formatCop(product.price_cop ?? 0, locale);

  const occurrenceLabel =
    reservationMode === "evento"
      ? formatOccurrenceLabel(
          {
            occurrenceType: product.occurrence_type as "once" | "recurring" | null,
            occurrenceDate: product.occurrence_date,
            recurrenceFrequencyDays: product.recurrence_frequency_days,
            recurrenceEndDate: product.recurrence_end_date,
            recurrenceEndCount: product.recurrence_end_count,
          },
          locale,
          // Cast : le Translator scopé au namespace n'accepte que ses clés littérales, plus étroit
          // que OccurrenceTranslator (key: string) — cf. formatOccurrenceLabel.test.ts pour le même
          // besoin et sa justification complète.
          tOccurrence as unknown as (key: string, values?: Record<string, string | number>) => string
        )
      : null;

  const photoSlides = (media ?? []).map((m) => ({
    id: m.id,
    alt: name,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const establishmentPhotoSlides = (establishmentMedia ?? []).map((m) => ({
    id: m.id,
    alt: establishmentName,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // Données structurées, construites ICI et non dans ProductDetailView : la vue cliente ne reçoit
  // ni le slug ni le type, et reçoit le prix DÉJÀ FORMATÉ en chaîne (priceDisplay) — inutilisable
  // pour une offre. Le Server Component a les valeurs brutes (spec 26 §5.4).
  const siteUrl = getSiteUrl();
  const productJsonLd = buildProductJsonLd({
    siteUrl,
    locale,
    slug: product.slug,
    name,
    description,
    imageUrls: photoSlides.map((slide) => slide.url),
    productType: product.type as string,
    priceCop: product.price_cop,
    occurrenceDate: product.occurrence_date,
    startTime: product.start_time,
    location: establishmentName ? { name: establishmentName, address: establishmentAddress } : null,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(siteUrl, [
    { name: tCommon("breadcrumbHome"), path: `/${locale}` },
    { name, path: `/${locale}/products/${product.slug}` },
  ]);

  return (
    <>
      <JsonLd data={productJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <ProductDetailView
        name={name}
        description={description}
        photoSlides={photoSlides}
        priceDisplay={priceDisplay}
        unit={product.unit}
        capacity={product.capacity}
        unitCount={product.unit_count}
        lodgingKind={asLodgingKind(product.lodging_kind)}
        reservationMode={reservationMode}
        occurrenceLabel={occurrenceLabel}
        externalBookingUrl={product.external_booking_url}
        productId={product.id}
        establishmentName={establishmentName}
        establishmentSlug={product.establishment?.slug ?? null}
        establishmentDescription={establishmentDescription}
        establishmentAddress={establishmentAddress}
        establishmentPhotoSlides={establishmentPhotoSlides}
        priceCop={product.price_cop ?? 0}
        lodgingPriceTiers={
          product.price_tiers as { min_qty: number; max_qty: number; price_cop: number }[] | null
        }
        lodgingMaxQty={product.max_qty ?? 20}
        isPmsBacked={productIsPmsBacked}
        availability={availability ?? []}
        productDateRates={productDateRates ?? []}
        productSlots={productSlots ?? []}
      />
    </>
  );
}
