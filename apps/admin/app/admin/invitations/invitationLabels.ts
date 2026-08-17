// Extrait de invitations/page.tsx (docs/specs/10-listes-standardisees-admin-socio.md, lot 4) —
// même raison que orders/statusLabels.ts : partagé entre le rendu de la liste
// (InvitationsList.tsx) et les options du filtre (@/lib/lists/filters.ts).
export const ONBOARDING_PATH_LABELS: Record<string, string> = {
  referrer: "Referente",
  provider: "Prestador",
};

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  consumed: "Consumida",
  revoked: "Revocada",
  expired: "Expirada",
};

export const INVITATION_STATUS_CHIP_COLOR: Record<
  string,
  "default" | "accent" | "success" | "danger"
> = {
  pending: "accent",
  consumed: "success",
  revoked: "danger",
  expired: "default",
};
