"use client";

import Image from "next/image";
import { Card, Carousel, Chip, cn, type CarouselSlide, type ChipVariants } from "@hifago/ui";

export type CatalogCardStatus = {
  label: string;
  color: NonNullable<ChipVariants["color"]>;
  testId?: string;
};

export type CatalogCardPhoto = CarouselSlide & { url: string };

export type CatalogCardProps = {
  testId: string;
  photos: CatalogCardPhoto[];
  title: string;
  /** Établissement rattaché — omis côté écran établissement (rien de plus haut à afficher). */
  subtitle?: string;
  tags?: string[];
  statusChips: CatalogCardStatus[];
  meta?: string;
  footer: React.ReactNode;
  /**
   * "vertical" (défaut) : photo en pleine largeur au-dessus du contenu — grille de petites cartes
   * (/partner/products, activités sous un établissement). "horizontal" : carrousel à largeur FIXE
   * (300px, empilé sous `sm`) à gauche, contenu à sa droite — carte établissement pleine largeur
   * (retour Jérôme 2026-08-19 : "toute la longueur" visait la CARTE, jamais une photo géante).
   */
  layout?: "vertical" | "horizontal";
};

/**
 * Grille de grosses cartes réutilisée par /partner/products et /partner/establishment (carrousel
 * + statut superposé + titre + pied d'actions) — les deux écrans ne diffèrent que par les données
 * et les actions du pied, jamais par la charpente visuelle. Colocalisé dans apps/admin/components
 * (pas packages/ui) : dépend de next/image, alors que packages/ui reste volontairement indépendant
 * de Next.js (même raison que le renderSlide en render-prop de Carousel).
 */
export function CatalogCard({
  testId,
  photos,
  title,
  subtitle,
  tags,
  statusChips,
  meta,
  footer,
  layout = "vertical",
}: CatalogCardProps) {
  const isHorizontal = layout === "horizontal";

  const photoBlock = (
    <div className={cn("relative", isHorizontal ? "w-full shrink-0 sm:w-[300px]" : "w-full")}>
      {photos.length > 0 ? (
        <Carousel
          slides={photos}
          variant="gallery"
          renderSlide={(slide, index) => (
            <div className="relative aspect-[4/3] w-full">
              <Image
                src={slide.url}
                alt={slide.alt}
                fill
                className="object-cover"
                priority={index === 0}
                loading={index === 0 ? undefined : "lazy"}
                sizes={isHorizontal ? "(max-width: 639px) 100vw, 300px" : "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"}
              />
            </div>
          )}
        />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-surface-secondary text-sm text-muted">
          Sin fotos
        </div>
      )}

      {statusChips.length > 0 ? (
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {statusChips.map((status) => (
            <Chip
              key={status.label}
              variant="soft"
              color={status.color}
              className="pointer-events-auto bg-surface/90"
              data-testid={status.testId}
            >
              {status.label}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );

  const contentBlock = (
    <>
      <Card.Content className="gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="line-clamp-1 text-base font-semibold">{title}</h3>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
          {meta ? <p className="text-sm text-muted">{meta}</p> : null}
        </div>

        {tags && tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Chip key={tag} variant="soft" color="accent" size="sm">
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
      </Card.Content>

      <Card.Footer className="flex-wrap gap-2">{footer}</Card.Footer>
    </>
  );

  if (isHorizontal) {
    return (
      <Card data-testid={testId}>
        <div className="flex flex-col sm:flex-row">
          {photoBlock}
          <div className="flex flex-1 flex-col">{contentBlock}</div>
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid={testId}>
      {photoBlock}
      {contentBlock}
    </Card>
  );
}

export function CatalogCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
