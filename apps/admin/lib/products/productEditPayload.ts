import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import { lowestTierPrice, toPriceTiersColumn } from "@/lib/products/priceTiers";
import { toStayRatesColumn } from "@/lib/products/stayRates";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Construit le payload jsonb attendu par submit_product_proposal / le p_corrected_payload de
// moderate_product_proposal (kind='content') — miroir exact du bloc `if (isEditing && product)` de
// ProductForm.handleSubmit (product-form.tsx) : mêmes champs, jamais tags/photos/slot_rules/
// room_types (délégués à des blocs séparés à sauvegarde immédiate côté admin, jamais couverts par
// ce même submit là non plus — cf. tête de migration 20260817150000).
export function buildProductEditPayload(
  type: ProductType,
  name: LocalizedValue,
  description: LocalizedValue,
  fields: ProductTypeFieldsState,
): Record<string, unknown> {
  const { isHotel, isEvento, hasLocationAndTags, hasPriceQtyFields, hasCheckInOut, isLodging, hasDefaultCapacity } =
    productTypeGating(type);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";
  const needsOwnPrice = !isEvento && !isHotel;

  return {
    name: buildLocalizedPayload(name) ?? { es: name.es?.trim() ?? "" },
    description: buildLocalizedPayload(description) ?? null,
    ...(hasLocationAndTags
      ? {
          address: fields.address.trim() || null,
          lat: fields.lat.trim() ? Number(fields.lat) : null,
          lon: fields.lon.trim() ? Number(fields.lon) : null,
        }
      : {}),
    ...(needsOwnPrice
      ? { price_cop: usesTiers ? lowestTierPrice(fields.priceTiers) : Number(fields.priceCop) }
      : {}),
    price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
    ...(hasPriceQtyFields
      ? {
          min_qty: fields.minQty.trim() ? Number(fields.minQty) : null,
          max_qty: fields.maxQty.trim() ? Number(fields.maxQty) : null,
        }
      : {}),
    ...(hasCheckInOut
      ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
      : {}),
    ...(isLodging
      ? {
          capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
          // Miroir exact de productCreationPayload (cf. son commentaire) : même clé whitelistée des
          // deux côtés, sinon une modification effacerait la valeur posée à la création.
          unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
          lodging_kind: fields.lodgingKind || null,
          stay_rates: toStayRatesColumn(fields.stayRates),
        }
      : {}),
    ...(hasDefaultCapacity
      ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
      : {}),
  };
}
