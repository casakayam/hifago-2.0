import { createClient } from "@hifago/supabase/server";
import { resolveLocalizedField, asLocalizedField } from "@hifago/domain";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — lecture JOINTE du panier de l'appelant, réservée aux Server
// Components (`/carrito`, `/pago`) : `cart_items` ne stocke que `product_id` (décision ②, jamais
// de type/nom/photo/établissement dénormalisés) — c'est cette fonction qui fait la jointure vers
// `products`/`establishments` au moment de l'affichage, jamais côté client (aucun précédent dans
// ce dépôt d'une requête `.from()` jointe depuis un composant client — cf. `lib/catalog/`, qui ne
// sert que depuis des Server Components).
export type CartLineForDisplay = {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  productSlug: string;
  establishmentId: string;
  establishmentName: string;
  date: string;
  endDate: string | null;
  slotStartTime: string | null;
  qty: number;
  priceCop: number;
  // Vérification minimale (products.sellable) — le mécanisme complet de revérification de
  // disponibilité à la reprise du panier reste un point ouvert (spec 32 §10), pas réinventé ici.
  unavailable: boolean;
};

export async function getCartLines(locale: Locale): Promise<CartLineForDisplay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cart_items")
    .select(
      "id, product_id, date, end_date, slot_start_time, qty, created_at, products(name, type, slug, price_cop, sellable, establishment_id, establishment:establishments(id, name))"
    )
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => {
    const product = row.products;
    const establishment = product?.establishment;
    return {
      id: row.id,
      productId: row.product_id,
      productName: resolveLocalizedField(asLocalizedField(product?.name), locale) ?? "",
      productType: product?.type ?? "",
      productSlug: product?.slug ?? "",
      establishmentId: establishment?.id ?? "",
      establishmentName: resolveLocalizedField(asLocalizedField(establishment?.name), locale) ?? "",
      date: row.date,
      endDate: row.end_date,
      slotStartTime: row.slot_start_time,
      qty: row.qty,
      priceCop: product?.price_cop ?? 0,
      unavailable: !product?.sellable,
    };
  });
}
