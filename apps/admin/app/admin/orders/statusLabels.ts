// Extrait de OrdersTable.tsx (feature 27, retrofit pagination/filtre serveur) — page.tsx (Server
// Component) doit valider le paramètre ?status= reçu de l'URL contre ce même vocabulaire, sans
// importer un fichier "use client" pour une simple constante.
export const STATUS_LABELS: Record<string, string> = {
  reserved: "Reservada",
  fulfilled: "Realizada",
  no_show: "Ausencia",
  cancelled_by_client: "Anulada (cliente)",
  cancelled_by_provider: "Anulada (prestador)",
  expired: "Expirada",
  // Spec 17 §0 Tranche 1 — modify_order_line ne modifie jamais une ligne en place, elle la
  // remplace : l'ancienne passe superseded (jamais un retour vers reserved), la nouvelle porte la
  // date/qty à jour. Sans cette entrée, l'admin verrait la valeur brute non traduite dans la liste.
  superseded: "Sustituida",
};

export const STATUS_CHIP_COLOR: Record<
  string,
  "default" | "accent" | "success" | "warning" | "danger"
> = {
  reserved: "accent",
  fulfilled: "success",
  no_show: "danger",
  cancelled_by_client: "default",
  cancelled_by_provider: "default",
  expired: "default",
  superseded: "default",
};
