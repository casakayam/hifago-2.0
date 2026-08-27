// Nature du couchage d'un produit `type='lodging'` — colonne `products.lodging_kind`, migration
// 20260827120000. Déclarée dans le domaine et non dans apps/admin parce que TROIS couches la
// lisent : le formulaire admin/socio (Select), le parcours d'import LobbyPMS (lobbyRoomImport) et
// la fiche publique (apps/web). Une redéclaration par couche pouvait diverger sans erreur de
// compilation — le précédent exact est LobbyRoomOption, dont le /simplify du 2026-08-26 a montré
// que les trois copies s'étaient déjà écartées.
//
// POURQUOI TROIS VALEURS. `whole_house` n'est pas spéculatif : la v1 en production porte
// `mode: 'whole_house'` sur Bania Travel (src/config/properties.js du dépôt legacy) pendant que
// Casa Kayam est en `mode: 'rooms'`. Un partenaire réel se loue déjà maison entière.
//
// CE QUE LOBBY PEUT ET NE PEUT PAS REMPLIR. Le vocabulaire de LobbyPMS n'a que deux termes,
// `privada` et `compartida` (observés le 2026-08-26 sur le compte réel), qui donnent `private` et
// `dorm` — jamais `whole_house`. C'est pourquoi LobbyRoomKind, dans pms/parseLobbyRooms.ts, reste
// délibérément à DEUX valeurs : il décrit le vocabulaire de Lobby, pas celui de hifago. Ce type-ci
// en est le sur-ensemble, et `whole_house` sera toujours un choix manuel.
//
// CE QUE CE N'EST PAS : `products.unit`. `unit` est une unité de PRIX (la fiche publique s'en sert
// pour imprimer « por persona » à côté du montant), `lodging_kind` une nature de couchage. La
// correspondance n'est pas mécanique — la catégorie « CAMPER Van » du compte réel est `privada`
// avec `capacity: 4`, et sûrement pas vendue « per_two ».
//
// DESCRIPTIF : aucune RPC de commande ne le lit, il n'autorise ni ne refuse jamais une réservation.
export const LODGING_KINDS = ["dorm", "private", "whole_house"] as const;

export type LodgingKind = (typeof LODGING_KINDS)[number];

/**
 * Normalise une valeur venue de la base ou d'un payload jsonb. La colonne est typée `string | null`
 * côté types générés : sans ce filtre, une valeur hors domaine traverserait jusqu'au Select (qui
 * n'afficherait alors aucune option, sans rien signaler) ou jusqu'à la fiche publique (qui
 * chercherait une clé i18n inexistante). Tout ce qui n'est pas l'une des trois valeurs devient
 * `null` — « non renseigné », qui est un état légitime : la colonne est facultative.
 */
export function asLodgingKind(value: unknown): LodgingKind | null {
  return typeof value === "string" && (LODGING_KINDS as readonly string[]).includes(value)
    ? (value as LodgingKind)
    : null;
}
