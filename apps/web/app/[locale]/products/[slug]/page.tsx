import type { Metadata } from "next";
import { cache } from "react";
import { addDays } from "date-fns";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, isPmsBacked, resolveLocalizedField } from "@hifago/domain";
import { formatOccurrenceLabel } from "@/lib/products/formatOccurrenceLabel";
import { formatCop } from "@hifago/domain";
import { ProductDetailView } from "./ProductDetailView";

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
const PRODUCT_COLUMNS = `id, slug, name, description, price_cop, price_tiers, min_qty, max_qty, unit, capacity, unit_count, type, price_label, external_booking_url, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, lobby_category_id, establishment:establishments(id, name, description, address)`;

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
  // reste noindex + canonical vers la langue source (es, la locale de repli de
  // resolveLocalizedField) tant qu'aucune vraie traduction n'existe — jamais indexée comme une
  // page distincte.
  const hasNativeContent = Boolean(asLocalizedField(product.name)?.[locale]);

  return {
    title,
    description,
    robots: hasNativeContent ? undefined : { index: false, follow: true },
    alternates: {
      canonical: hasNativeContent
        ? `/${locale}/products/${product.slug}`
        : `/es/products/${product.slug}`,
      // Uniquement les locales d'interface routées (es/en) — jamais la liste dynamique de
      // langues de contenu du produit (cf. hifago/CLAUDE.md §5.2).
      languages: {
        es: `/es/products/${product.slug}`,
        en: `/en/products/${product.slug}`,
      },
    },
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/[locale]/products/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  // Le rendu JSX vit désormais dans ProductDetailView.tsx ("use client"), qui appelle
  // useTranslations lui-même — une fonction traducteur next-intl obtenue côté serveur
  // (getTranslations) n'est pas sérialisable à travers la frontière Server → Client Component.
  // `t`/`tOccurrence` restent nécessaires ICI uniquement pour composer des chaînes déjà
  // finalisées (hotelPriceLabel, occurrenceLabel) avant de les passer en props.
  const t = await getTranslations("ProductPage");
  const tOccurrence = await getTranslations("ProductPage.occurrence");

  const supabase = await createClient();
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  // Feature 21 : un evento vitrine n'a ni cupo ni panier — la disponibilité n'a aucun sens pour ce
  // type, jamais consultée (contrairement aux autres types, réservables via create_order).
  const isEvento = product.type === "evento";
  // Spec 17 §0 Tranche 2 : un hôtel ne se réserve jamais "en gros" (product_availability générique
  // ne représente aucune chambre réelle, cf. create_order room_type_required) — écran dédié avec
  // sélecteur de chambre, jamais le ReservationForm générique.
  const isHotel = product.type === "hotel";
  // Spec 17 §0 Tranche 2 : un alojamiento se réserve par plage de nuits (check-in/check-out), pas
  // par date unique — écran dédié (LodgingReservationForm, pendant de HotelReservationForm sans
  // sélecteur de chambre), jamais le ReservationForm générique non plus.
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

  // today lié une seule fois (pas un new Date() par site) — new Date() seul reste toléré en corps
  // de composant par la règle react-hooks/purity, jamais Date.now()/l'arithmétique associée.
  // todayIso (cutoff "à partir d'aujourd'hui") est dérivé une seule fois ici et réutilisé aux 4
  // sites qui en ont besoin ci-dessous (get_product_slots p_from, et les 3 gte("date", …) :
  // room_type_availability/room_type_date_rates/product_date_rates) — addDays(today, 180) (fenêtre
  // slots, plus bas) reste un calcul séparé, ce n'est pas le même cutoff.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // availability/slotRulesCount/roomTypesRaw/productDateRates/media ne dépendent QUE de
  // product.type/product.id (connus synchronement dès getProduct() ci-dessus) — aucune dépendance
  // entre elles, un seul aller-retour réseau groupé plutôt que 5 attentes séquentielles. Un helper
  // par requête (plutôt qu'un ternaire direct dans le tableau du Promise.all) : TypeScript infère
  // ainsi le type de retour exactement comme l'ancien `cond ? { data: [] } : await supabase...`
  // ligne par ligne, sans annotation manuelle — et l'appel de chaque helper démarre sa requête tout
  // de suite (même tick), donc en vrai parallèle malgré l'`await` interne à chacun. Les vrais
  // enchaînements dépendants restent APRÈS ce Promise.all : productSlots (a besoin du résultat de
  // slotRulesCount/isSlotBased ci-dessous) et roomAvailability/roomRates (déjà groupés eux-mêmes,
  // ont besoin de roomTypeIds issu de roomTypesRaw).
  const fetchAvailability = async () =>
    isEvento || isHotel
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
    isEvento || isHotel || isLodging
      ? { count: 0 }
      : await supabase
          .from("product_slot_rules")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id);

  const fetchRoomTypesRaw = async () =>
    isHotel
      ? await supabase
          .from("product_room_types")
          .select("id, kind, name, capacity, price_cop, price_tiers, min_qty, max_qty")
          .eq("product_id", product.id)
          .order("sort")
      : { data: [] };

  // Spec 17 §0 Tranche 2 : override de prix par nuit pour un alojamiento (mécanique identique à
  // room_type_date_rates ci-dessous, mais sur product_id directement — pas de chambre à filtrer).
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
    { data: roomTypesRaw },
    { data: productDateRates },
    { data: media },
    { data: establishmentMedia },
  ] = await Promise.all([
    fetchAvailability(),
    fetchSlotRulesCount(),
    fetchRoomTypesRaw(),
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
  // rendu (evento > hotel > lodging > slot > date), préservé à l'identique.
  const reservationMode: "evento" | "hotel" | "lodging" | "slot" | "date" = isEvento
    ? "evento"
    : isHotel
      ? "hotel"
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
          p_to: addDays(today, 180).toISOString().slice(0, 10),
        })
      : { data: [] };

  const roomTypeIds = (roomTypesRaw ?? []).map((r) => r.id);
  const [{ data: roomAvailability }, { data: roomRates }] =
    roomTypeIds.length > 0
      ? await Promise.all([
          supabase
            .from("room_type_availability")
            .select("room_type_id, date, capacity, booked")
            .in("room_type_id", roomTypeIds)
            .gte("date", todayIso),
          supabase
            .from("room_type_date_rates")
            .select("room_type_id, date, price_cop")
            .in("room_type_id", roomTypeIds)
            .gte("date", todayIso),
        ])
      : [{ data: [] }, { data: [] }];

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
  // à la différence de price_cop pour tous les autres types. Un hôtel n'a pas de price_cop propre
  // (le prix vit sur ses chambres, cf. products_price_cop_required_unless_evento) : "Desde {prix
  // le plus bas}" plutôt qu'un $0 trompeur si aucune chambre n'a encore été définie.
  const cheapestRoomPriceCop =
    roomTypesRaw && roomTypesRaw.length > 0
      ? Math.min(...roomTypesRaw.map((r) => r.price_cop))
      : null;
  const hotelPriceLabel =
    cheapestRoomPriceCop !== null ? `${t("fromPrice")} ${formatCop(cheapestRoomPriceCop, locale)}` : null;
  const priceDisplay =
    reservationMode === "evento"
      ? product.price_label
      : reservationMode === "hotel"
        ? hotelPriceLabel
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

  return (
    <ProductDetailView
      name={name}
      description={description}
      photoSlides={photoSlides}
      priceDisplay={priceDisplay}
      unit={product.unit}
      capacity={product.capacity}
      unitCount={product.unit_count}
      reservationMode={reservationMode}
      occurrenceLabel={occurrenceLabel}
      externalBookingUrl={product.external_booking_url}
      productId={product.id}
      establishmentName={establishmentName}
      establishmentDescription={establishmentDescription}
      establishmentAddress={establishmentAddress}
      establishmentPhotoSlides={establishmentPhotoSlides}
      roomTypes={(roomTypesRaw ?? []).map((room) => ({
        id: room.id,
        name: resolveLocalizedField(asLocalizedField(room.name), locale) ?? room.id,
        kind: room.kind as "dorm" | "private",
        capacity: room.capacity,
        priceCop: room.price_cop,
        priceTiers: room.price_tiers as
          | { min_qty: number; max_qty: number; price_cop: number }[]
          | null,
        minQty: room.min_qty ?? 1,
        maxQty: room.max_qty ?? 20,
      }))}
      roomAvailability={roomAvailability ?? []}
      roomRates={roomRates ?? []}
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
  );
}
