import { buildLocalizedPayload, type LocalizedValue } from "@/components/localized-text-field";
import { lowestTierPrice, toPriceTiersColumn } from "@/lib/products/priceTiers";
import { toStayRatesColumn } from "@/lib/products/stayRates";
import { toProgramColumn } from "@/lib/products/program";
import { toGroupDiscountColumns } from "@/lib/products/groupDiscount";
import { toTransportInfoColumns } from "@/lib/products/transportInfo";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Construit le payload jsonb attendu par submit_product_proposal / le p_corrected_payload de
// moderate_product_proposal (kind='content') — miroir exact du bloc `if (isEditing && product)` de
// ProductForm.handleSubmit (product-form.tsx) : mêmes champs, jamais tags/photos/slot_rules/
// (délégués à des blocs séparés à sauvegarde immédiate côté admin, jamais couverts par
// ce même submit là non plus — cf. tête de migration 20260817150000).
export function buildProductEditPayload(
  type: ProductType,
  name: LocalizedValue,
  description: LocalizedValue,
  fields: ProductTypeFieldsState,
): Record<string, unknown> {
  const {
    isEvento, hasLocationAndTags, hasPriceQtyFields, hasCheckInOut, isLodging, hasDefaultCapacity,
    isTransport, isCamp,
  } = productTypeGating(type);
  const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";
  const needsOwnPrice = !isEvento;
  // Même garde que productCreationPayload : `Number("")` vaut 0, PAS NaN, et 0 est refusé par
  // `products_price_cop_positive`. Sans ce `> 0`, effacer le prix d'un produit pour le passer en
  // vitrine faisait échouer l'approbation de la proposition (mesuré le 2026-09-09).
  const prixSaisi = Number(fields.priceCop);
  const priceCopOuNull = Number.isFinite(prixSaisi) && prixSaisi > 0 ? prixSaisi : null;

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
      ? { price_cop: usesTiers ? lowestTierPrice(fields.priceTiers) : priceCopOuNull }
      : {}),
    price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
    // Miroir exact du bloc d'édition de ProductForm (product-form.tsx) : la vitrine reste
    // modifiable après création. Ces deux clés manquaient ici ET dans la whitelist de
    // submit_product_proposal — un socio ne pouvait donc pas corriger l'URL d'une vitrine qu'il
    // avait lui-même proposée (migration 20260909180000, qui ouvre l'autre moitié du chemin).
    ...(isEvento
      ? {}
      : {
          external_booking_url: fields.externalBookingUrl.trim() || null,
          price_label: fields.externalBookingUrl.trim() ? fields.priceLabel.trim() || null : null,
        }),
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
          unit: fields.unit || null,
          stay_rates: toStayRatesColumn(fields.stayRates),
        }
      : {}),
    ...(hasDefaultCapacity
      ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
      : {}),
    // Transport informatif (migration 20260916150000, demande Jérôme du 2026-09-16) : fenêtre de
    // départs, places annoncées par départ, et les DEUX lieux dédiés — `transport_departure_*`
    // remplace le trio générique `address`/`lat`/`lon` pour ce type (retiré d'`hasLocationAndTags`).
    // Une seule définition des 9 colonnes, partagée avec le chemin d'édition (`toTransportInfoColumns`) :
    // les écrire à la main de chaque côté est ce qui avait déjà fait diverger `price_label`.
    ...(isTransport ? toTransportInfoColumns(fields.transportInfo) : {}),
    // Bloc camp — il n'existait PAS dans ce fichier jusqu'au 2026-09-16, et c'était un bug réel,
    // pas une simplification : la whitelist SQL de submit_product_proposal construit
    // `jsonb_build_object('group_discount_pct', p_payload -> 'group_discount_pct')`, donc pour un
    // camp la clé est TOUJOURS présente dans le payload stocké — à null quand ce fichier ne
    // l'émet pas. La garde `v_final_payload ? 'group_discount_pct'` de moderate_product_proposal
    // la voit alors présente et écrit null : approuver une édition socio EFFAÇAIT la remise de
    // groupe du camp. Reproduit en réel le 2026-09-16 (seuil 16 / 20 % → NULL après approbation)
    // en écrivant le programme — d'où la correction des deux ensemble.
    //
    // Règle à retenir pour la suite : pour un camp, tout champ whitelisté côté SQL DOIT être émis
    // ici, sinon chaque édition approuvée l'efface silencieusement.
    ...(isCamp
      ? {
          ...toGroupDiscountColumns(fields.groupDiscount),
          program: toProgramColumn(fields.program),
        }
      : {}),
  };
}
