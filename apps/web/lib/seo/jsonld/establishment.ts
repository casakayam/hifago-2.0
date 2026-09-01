export type EstablishmentJsonLdInput = {
  siteUrl: string;
  locale: string;
  slug: string;
  name: string;
  description?: string | null;
  imageUrls?: string[];
  /** `establishments.address` — chaîne unique, cf. avertissement ci-dessous. */
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** `establishments.mode` : 'rooms' | 'whole_house' | null (null = pas un hébergement). */
  mode?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

/**
 * Données structurées d'une page établissement.
 *
 * ⚠️ L'adresse N'EST PAS décomposable et on ne fait pas semblant : `establishments.address` est
 * une chaîne unique (le `formattedAddress` de Google), et
 * apps/admin/components/address-autocomplete.ts ne demande que `formattedAddress` + `location`.
 * Aucun composant (`addressLocality`, `postalCode`, `addressRegion`) n'est persisté nulle part.
 * Seul `addressCountry` est réellement garanti — l'autocomplétion est restreinte à la Colombie.
 *
 * ⚠️ `geo` est CONDITIONNEL : `lat`/`lon` existent en base et sont accordés à `anon`, mais restent
 * souvent vides (le seed ne les peuple jamais). Un nœud `geo` à coordonnées nulles placerait
 * l'établissement au large du golfe de Guinée.
 *
 * ⚠️ Ni `telephone` ni `email` : aucune colonne de contact n'existe sur `establishments`, et
 * celles de `partners` ne sont pas accordées au rôle `anon`. Ni `openingHours` : `check_in_time`
 * et `check_out_time` sont des horaires d'ARRIVÉE et de DÉPART, pas des heures d'ouverture.
 * Ni `aggregateRating` : aucune table d'avis n'existe.
 */
export function buildEstablishmentJsonLd(
  input: EstablishmentJsonLdInput
): Record<string, unknown> {
  const url = `${input.siteUrl}/${input.locale}/establishments/${input.slug}`;
  const hasCoordinates =
    typeof input.latitude === "number" && typeof input.longitude === "number";

  return {
    "@context": "https://schema.org",
    // `mode` renseigné signifie « on y dort » (rooms ou whole_house) ; sinon c'est un lieu
    // d'activité. La distinction vient de la base, elle n'est pas devinée du nom.
    "@type": input.mode ? "LodgingBusiness" : "LocalBusiness",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrls?.length ? { image: input.imageUrls } : {}),
    url,
    inLanguage: input.locale,
    ...(input.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: input.address,
            addressCountry: "CO",
          },
        }
      : {}),
    ...(hasCoordinates
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: input.latitude,
            longitude: input.longitude,
          },
        }
      : {}),
    ...(input.checkInTime ? { checkinTime: input.checkInTime } : {}),
    ...(input.checkOutTime ? { checkoutTime: input.checkOutTime } : {}),
  };
}
