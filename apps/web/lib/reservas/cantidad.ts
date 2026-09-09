/**
 * Borne une quantité saisie entre 1 et un maximum.
 *
 * ⚠️ LA GARDE `NaN` N'EST PAS DÉCORATIVE, et elle n'existait que dans UN des trois formulaires
 * (`LodgingReservationForm`) — les deux autres écrivaient `Math.min(Math.max(next, 1), max)`, or
 * `Math.max(NaN, 1)` vaut `NaN` et `setQty(NaN)` passe sans rien casser de visible : le champ
 * devient vide, le bouton reste actif, et le panier reçoit une quantité non finie.
 *
 * Le champ HTML `type="number"` rend probablement `""` (donc 0, donc borné à 1) plutôt que du
 * texte, ce qui rendrait le trou inatteignable par un utilisateur réel — mais l'asymétrie de code
 * était réelle, et c'est exactement ce qu'une extraction est censée refermer. Mesuré : spec 30 §7a,
 * duplication n°1.
 *
 * `max` est borné à 1 : un produit complet doit quand même afficher « 1 » dans son champ, sinon la
 * borne haute passerait sous la borne basse.
 */
export function limitarCantidad(bruto: number, max: number): number {
  if (!Number.isFinite(bruto)) return 1;
  return Math.min(Math.max(bruto, 1), Math.max(max, 1));
}
