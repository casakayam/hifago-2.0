"use client";

import Link from "next/link";
import { formatCop } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { CatalogCard, CatalogCardGrid, type CatalogCardStatus } from "@/components/catalog-card";
import { availabilityScreenFor, type ProductType } from "@/lib/products/useProductTypeFieldsState";

export type ProductCardRow = {
  id: string;
  type: string;
  name: string;
  priceCop: number | null;
  sellable: boolean;
  establishmentName: string | null;
  tags: string[];
  photos: { id: string; url: string; alt: string }[];
  pendingEdit: boolean;
  hasSlotRules: boolean;
};

// Grille de grosses cartes (carrousel + tags + établissement rattaché + statut) — remplace
// l'ancienne Table HeroUI (render-prop non sérialisable à travers Server->Client, même contrainte
// documentée CLAUDE.md §2.3 pour Table, reprise ici pour Carousel.renderSlide).
export function ProductsGrid({ products }: { products: ProductCardRow[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted">Ninguna actividad todavía.</p>;
  }

  return (
    <CatalogCardGrid>
      {products.map((product) => {
        // Un tag de statut à la fois, jamais deux empilés : "en révision" prend le pas sur
        // publié/brouillon plutôt que s'y ajouter — la fiche reste une carte normale entre-temps,
        // seul le tag change (retour Jérôme).
        const statusChips: CatalogCardStatus[] = product.pendingEdit
          ? [{ label: "Edición pendiente de revisión", color: "warning" }]
          : [
              product.sellable
                ? { label: "Publicada", color: "success" }
                : { label: "No publicada", color: "default" },
            ];

        // Gating partagé avec apps/admin/app/admin/products/[id]/edit/page.tsx via
        // availabilityScreenFor (apps/admin/lib/products/useProductTypeFieldsState.ts) — avant
        // cette extraction, ce gating était redérivé ici ad hoc et divergeait déjà silencieusement
        // du edit/page.tsx admin sur evento (celui-ci n'affichait aucun lien, celui-ci affichait
        // "Calendario" comme n'importe quel autre type non-hôtel).
        const availabilityScreen = availabilityScreenFor(
          product.type as ProductType,
          product.hasSlotRules,
        );

        return (
          <CatalogCard
            key={product.id}
            testId={`product-row-${product.id}`}
            photos={product.photos}
            title={product.name}
            subtitle={product.establishmentName ?? undefined}
            tags={product.tags}
            statusChips={statusChips}
            meta={product.priceCop === null ? undefined : formatCop(product.priceCop)}
            footer={
              <>
                <Link
                  href={`/partner/products/${product.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  data-testid={`edit-link-${product.id}`}
                >
                  Proponer edición
                </Link>
                {/* Écriture directe (feature 17) : à la différence de "Proponer edición" (une
                    proposition soumise à modération), gérer son propre calendrier de cupos
                    appartient au socio par nature (cahier des charges socio §3d), pas de
                    passage par une proposition ici. product_availability générique : ne
                    représente aucune chambre réelle pour un hôtel (spec 17 §0 Tranche 2), même
                    gating de type que apps/admin/app/admin/products/[id]/edit/page.tsx — via
                    availabilityScreenFor ci-dessus, plus jamais redérivé ici. */}
                {availabilityScreen === "generic" || availabilityScreen === "slot" ? (
                  <Link
                    href={`/partner/products/${product.id}/availability`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`availability-link-${product.id}`}
                  >
                    Calendario
                  </Link>
                ) : null}
                {availabilityScreen === "room" ? (
                  <Link
                    href={`/partner/products/${product.id}/room-availability`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`room-availability-link-${product.id}`}
                  >
                    Cupos por habitación
                  </Link>
                ) : null}
                {/* Spec 18 Tranche 1 — même raisonnement que le lien "Cupos por habitación" :
                    product_availability (lien "Calendario" ci-dessus) ne représente pas la
                    capacité par créneau horaire d'une activité qui porte des product_slot_rules
                    (ex. jetski) ; grille dédiée horaires×dates, affichée seulement si au moins une
                    règle existe. Vient TOUJOURS avec le lien "Calendario" ci-dessus
                    (availabilityScreenFor 'slot' n'exclut pas 'generic'), jamais à sa place. */}
                {availabilityScreen === "slot" ? (
                  <Link
                    href={`/partner/products/${product.id}/slot-availability`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`slot-availability-link-${product.id}`}
                  >
                    Cupos por horario
                  </Link>
                ) : null}
              </>
            }
          />
        );
      })}
    </CatalogCardGrid>
  );
}
