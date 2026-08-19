"use client";

import Link from "next/link";
import { buttonVariants } from "@hifago/ui";
import { CatalogCard, CatalogCardGrid, type CatalogCardStatus } from "@/components/catalog-card";
import { ESTABLISHMENT_STATUS_LABELS } from "@/lib/lists/filters";

export type EstablishmentCardRow = {
  id: string;
  name: string;
  status: string;
  pendingEdit: boolean;
  photos: { id: string; url: string; alt: string }[];
};

// establishments.status ('active'|'archived') — même vocabulaire ES que la liste admin
// (ESTABLISHMENT_STATUS_LABELS, apps/admin/lib/lists/filters.ts), jamais dupliqué ici.
const STATUS_CHIP_COLOR: Record<string, CatalogCardStatus["color"]> = {
  active: "success",
  archived: "default",
};

export function EstablishmentsGrid({ establishments }: { establishments: EstablishmentCardRow[] }) {
  return (
    <div data-testid="establishment-list">
      {establishments.length === 0 ? (
        <p className="text-sm text-muted">Aún no tienes ningún establecimiento rattachado.</p>
      ) : (
        <CatalogCardGrid>
          {establishments.map((establishment) => {
            // Un tag de statut à la fois, jamais deux empilés : "en révision" prend le pas sur
            // activo/archivado plutôt que s'y ajouter — la fiche reste une carte normale
            // entre-temps, seul le tag change (retour Jérôme).
            const statusChips: CatalogCardStatus[] = establishment.pendingEdit
              ? [{ label: "Edición pendiente de revisión", color: "warning", testId: "pending-edit-badge" }]
              : [
                  {
                    label: ESTABLISHMENT_STATUS_LABELS[establishment.status] ?? establishment.status,
                    color: STATUS_CHIP_COLOR[establishment.status] ?? "default",
                  },
                ];

            return (
              <CatalogCard
                key={establishment.id}
                testId={`establishment-row-${establishment.id}`}
                photos={establishment.photos}
                title={establishment.name}
                statusChips={statusChips}
                footer={
                  <Link
                    href={`/partner/establishment/${establishment.id}/edit`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`edit-establishment-link-${establishment.id}`}
                  >
                    Editar
                  </Link>
                }
              />
            );
          })}
        </CatalogCardGrid>
      )}
    </div>
  );
}
