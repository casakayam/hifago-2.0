// Le choix de mode de POST /api/pms/import-room-photos, isolé en fonction PURE — parce que c'est
// une décision de sécurité et que c'était la seule frontière d'autorisation du chantier sans aucun
// test (/simplify du 2026-08-26).
//
// Les deux modes n'ont pas la même garde : `attach` est admin-only, `stage` est ouvert à l'operator
// actif de l'établissement. Ce qui empêche un corps forgé d'emprunter la garde faible n'est PAS
// l'ordre des branches dans la route (le commentaire d'origine le prétendait, à tort) : c'est que
// le prédicat de `stage` est exactement « la clé productId est absente ».
//
// La nuance compte. Un « nettoyage » en `if (!body.productId)` — idiome banal — ferait basculer
// `{productId: "", establishmentId, categoryId}` de `invalid` vers `stage`, donc d'un refus vers la
// garde la plus faible, sans que rien ne s'allume. D'où cette fonction, et son fichier de test.
export type LobbyImportMode = "attach" | "stage" | "invalid";

export function lobbyImportMode(body: unknown): LobbyImportMode {
  // `null` est un JSON valide, et un tableau aussi : les deux doivent être refusés avant tout
  // déréférencement, sinon la route lève un TypeError et répond 500 au lieu de 400.
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid";

  // Présence de la CLÉ, jamais véracité de la valeur : `{productId: ""}` et `{productId: null}`
  // désignent une intention de rattachement mal formée — ils tombent dans `attach`, qui exige
  // is_admin puis rejette en 400. Jamais dans `stage`.
  if ("productId" in body) return "attach";

  return "stage";
}
