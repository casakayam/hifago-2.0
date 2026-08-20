export interface PmsBackedCheckInput {
  type: string;
  lobbyCategoryId: number | null;
}

// Port 1:1 de catalogService.js (app legacy, src/services/catalogService.js) : la présence de
// lobby_category_id sur un produit lodging fait que LobbyPMS est source de vérité de la
// disponibilité ; son absence fait que le calendrier interne (product_calendar/
// product_availability) fait foi. Générique par construction, jamais un nom de prestataire en dur.
export function isPmsBacked(product: PmsBackedCheckInput): boolean {
  return product.type === "lodging" && product.lobbyCategoryId != null;
}
