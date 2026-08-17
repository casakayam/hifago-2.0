import { Chip } from "@hifago/ui";
import { INVITATION_STATUS_CHIP_COLOR, INVITATION_STATUS_LABELS } from "./invitationLabels";

// Rendu du badge de statut partagé entre InvitationsList.tsx (liste) et [id]/page.tsx (fiche
// détail) — même JSX, une seule source si son apparence évolue.
export function InvitationStatusChip({ status }: { status: string }) {
  return (
    <Chip variant="soft" color={INVITATION_STATUS_CHIP_COLOR[status] ?? "default"}>
      {INVITATION_STATUS_LABELS[status] ?? status}
    </Chip>
  );
}
