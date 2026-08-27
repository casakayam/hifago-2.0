import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import type { StagedPhoto } from "@/components/product-photos-staged";
import { lowestTierPrice, toPriceTiersColumn } from "@/lib/products/priceTiers";
import { toStayRatesColumn } from "@/lib/products/stayRates";
import { toSlotRuleRows } from "@/lib/products/slotRules";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Construit le payload jsonb attendu par submit_product_creation_proposal / le
// p_corrected_payload de moderate_product_proposal (kind='create') — miroir exact de ce que
// handleSubmit écrit directement dans `products` pour l'admin-direct (product-form.tsx), mêmes
// fonctions de conversion (toPriceTiersColumn/toStayRatesColumn/toSlotRuleRows/toRoomTypeRows),
// donc price_cop/price_tiers/slot_rules arrivent déjà dans la forme EXACTE des colonnes
// cibles — create_product_from_proposal (SQL) ne fait plus aucun calcul, seulement une transposition.
// `photos` (spec 15, révisé 2026-08-17) : les fichiers sont déjà uploadés vers Storage au moment
// de l'appel (StagedProductPhotos, réutilisé tel quel côté socio) — seul le storage_path traverse
// la proposition, jamais un binaire.
// Type de retour large (Record<string, unknown>, pas le Json récursif local à chaque formulaire) :
// cast au bord de l'appel .rpc(), même convention que les autres payloads jsonb du projet.
export function buildProductCreationPayload(
  type: ProductType,
  name: LocalizedValue,
  description: LocalizedValue,
  fields: ProductTypeFieldsState,
  stagedPhotos: StagedPhoto[] = [],
): Record<string, unknown> {
  const {
    isEvento, isCamp, isLodging, isActivity, isTransport,
    hasLocationAndTags, hasTags, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity,
  } = productTypeGating(type);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";

  return {
    name: buildLocalizedPayload(name) ?? { es: name.es?.trim() ?? "" },
    description: buildLocalizedPayload(description) ?? null,
    photos: stagedPhotos.map((photo) => ({ storage_path: photo.path })),
    ...(hasLocationAndTags
      ? {
          address: fields.address.trim() || null,
          lat: fields.lat.trim() ? Number(fields.lat) : null,
          lon: fields.lon.trim() ? Number(fields.lon) : null,
        }
      : {}),
    // Séparé d'hasLocationAndTags ci-dessus (retour Jérôme 2026-08-18) : camp a des tags
    // ("servicios incluidos") sans avoir d'adresse propre.
    ...(hasTags ? { tag_ids: fields.selectedTagIds } : {}),
    ...(hasPriceQtyFields
      ? {
          price_cop: usesTiers ? lowestTierPrice(fields.priceTiers) : Number(fields.priceCop),
          price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
          min_qty: fields.minQty.trim() ? Number(fields.minQty) : null,
          max_qty: fields.maxQty.trim() ? Number(fields.maxQty) : null,
        }
      : {}),
    ...(isCamp
      ? { price_cop: Number(fields.priceCop), duration_days: Number(fields.durationDays) }
      : {}),
    ...(hasCheckInOut
      ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
      : {}),
    ...(isLodging
      ? {
          capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
          // `unit_count` (renommé le 2026-08-27) : nombre d'unités du type, à côté de la capacité qui est
          // nombre d'occupants d'UNE unité. Whitelisté par submit_product_creation_proposal ET
          // submit_product_proposal (migration 20260826190000) — les deux, sinon le champ se
          // remplirait à la création puis disparaîtrait à la première modification.
          unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
          // `lodging_kind` (2026-08-27) : dortoir / chambre privée / maison entière. Whitelisté par
          // les DEUX RPC de proposition (migration 20260827120000), même raison que ci-dessus.
          lodging_kind: fields.lodgingKind || null,
          unit: fields.unit || null,
          stay_rates: toStayRatesColumn(fields.stayRates),
          // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — la RPC elle-même ignore ce champ
          // si l'établissement n'est pas connecté (cf. submit_product_creation_proposal), donc
          // aucun besoin de reconditionner ça ici.
          lobby_category_id: fields.lobbyCategoryId.trim() ? Number(fields.lobbyCategoryId) : null,
        }
      : {}),
    // Élargi le 2026-08-26 de isActivity seul à (isActivity || isTransport) — cf. commentaire de
    // tête de product-type-fields.tsx pour le raisonnement complet (evento/camp restent exclus).
    ...(isActivity || isTransport
      ? { lobby_product_id: fields.lobbyProductId.trim() ? Number(fields.lobbyProductId) : null }
      : {}),
    ...(hasDefaultCapacity
      ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
      : {}),
    ...(isActivity ? { slot_rules: toSlotRuleRows(fields.slotRules) } : {}),
    ...(isEvento
      ? {
          price_label: fields.priceLabel.trim(),
          occurrence_type: fields.occurrenceType,
          // Ancre nécessaire pour les deux modes désormais (cf. product-type-fields.tsx) — plus
          // seulement "once" : sans elle, un evento récurrent ne peut jamais dire sur quel jour de
          // semaine il tombe.
          occurrence_date: fields.occurrenceDate,
          recurrence_frequency_days:
            fields.occurrenceType === "recurring" ? Number(fields.recurrenceFrequencyDays) : null,
          recurrence_end_date:
            fields.occurrenceType === "recurring" && fields.recurrenceEndKind === "date"
              ? fields.recurrenceEndDate
              : null,
          recurrence_end_count:
            fields.occurrenceType === "recurring" && fields.recurrenceEndKind === "count"
              ? Number(fields.recurrenceEndCount)
              : null,
          start_time: fields.startTime || null,
          duration_minutes: fields.durationMinutes ? Number(fields.durationMinutes) : null,
          external_booking_url: fields.externalBookingUrl.trim() || null,
        }
      : {}),
  };
}
