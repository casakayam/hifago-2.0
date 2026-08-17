// Extrait de campaigns/page.tsx (docs/specs/10-listes-standardisees-admin-socio.md, lot 4) —
// même raison que orders/statusLabels.ts : partagé entre le rendu de la liste (CampaignsList.tsx)
// et les options du filtre (@/lib/lists/filters.ts), une seule source pour ne jamais diverger.
export const AUDIENCE_LABELS: Record<string, string> = {
  clients: "Clientes",
  referrers: "Referentes",
  providers: "Prestadores",
  partners: "Socios (referentes y prestadores)",
  all: "Todos",
};

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Correo electrónico",
};

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  completed: "Completada",
};

export const CAMPAIGN_STATUS_CHIP_COLOR: Record<string, "default" | "accent" | "success"> = {
  draft: "default",
  sending: "accent",
  completed: "success",
};
