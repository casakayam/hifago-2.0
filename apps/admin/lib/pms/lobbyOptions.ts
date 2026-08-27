import type { LobbyRoomCategory, LobbyService } from "@hifago/domain";

// Contrat de fil des endpoints `api/pms/lobby-rooms|lobby-services`, déclaré UNE fois (/simplify du
// 2026-08-26). Avant : chaque Route Handler exportait sa version — qu'aucun fichier n'importait —
// pendant que lobby-option-picker.tsx redéclarait la sienne à la main. Les deux pouvaient diverger
// sans erreur de compilation, et le scénario était concret : la route typait `descriptions` depuis
// le domaine (donc toutes les SupportedLang), le picker codait `{ es?: string; en?: string }` en
// dur. Ajouter une langue à SUPPORTED_LANGS aurait élargi la route sans élargir le picker, et la
// donnée aurait disparu en silence.
//
// Ce module est volontairement dans apps/admin/lib et non dans packages/domain : c'est la forme
// exposée AU NAVIGATEUR par ces deux routes, pas une notion du domaine LobbyPMS. Le domaine, lui,
// reste la source des types dérivés ci-dessous.

export type LobbyRoomOption = {
  id: number;
  name: string;
  kind: LobbyRoomCategory["kind"];
  rawType: string | null;
  /** Occupants d'UNE unité (Lobby : `capacity`). */
  capacity: number | null;
  /** Nombre d'unités de ce type (Lobby : `quantity`). Descriptif, jamais un quota de réservation. */
  quantity: number | null;
  descriptions: LobbyRoomCategory["descriptions"];
  /** Langues renvoyées par Lobby mais non éditables ici — signalées, jamais écrites. */
  unsupportedLangs: string[];
  photoUrls: string[];
  roomLabels: string[];
};

export type LobbyServiceOption = {
  id: number;
  name: string;
  /** Prix Lobby, indicatif : jamais le prix de vente hifago. */
  valueCop: number | null;
  infiniteInventory: boolean | null;
  stock: number | null;
};

export function toRoomOption(category: LobbyRoomCategory): LobbyRoomOption {
  return {
    id: category.categoryId,
    name: category.name,
    kind: category.kind,
    rawType: category.rawType,
    capacity: category.capacity,
    quantity: category.quantity,
    descriptions: category.descriptions,
    unsupportedLangs: category.unsupportedLangs,
    photoUrls: category.photos,
    roomLabels: category.roomLabels,
  };
}

export function toServiceOption(service: LobbyService): LobbyServiceOption {
  return {
    id: service.serviceId,
    name: service.name,
    valueCop: service.valueCop,
    infiniteInventory: service.infiniteInventory,
    stock: service.stock,
  };
}
