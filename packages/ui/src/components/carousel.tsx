"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Button } from "@heroui/react";
import { cn } from "../lib/utils";

/**
 * Carrousel/galerie client (spec docs/specs/04-gestion-images.md §10) — Embla plutôt qu'un
 * portage fidèle du carrousel 3D maison (~400 lignes JS vanilla, `reservar.js` legacy) : ce
 * dernier n'est pas une décision de conception à préserver, seulement un palliatif de l'absence de
 * composant réutilisable à l'époque. Embla est headless (même raisonnement qu'`ImageCrop`) — le
 * style visuel (dots, flèches, mode "hero") est posé par-dessus en HeroUI/Tailwind, jamais fourni
 * par la lib. Comportement legacy explicitement conservé : les dots/flèches n'apparaissent que si
 * `slides.length > 1` (règle §8 du spec).
 *
 * `packages/ui` reste indépendant de Next.js (même règle que `ServerPagination`) : ce composant ne
 * rend jamais `<img>`/`next/image` lui-même — l'appelant fournit `renderSlide`, ce qui permet à
 * `apps/web` de brancher `next/image` (lazy loading + `priority` sur le premier slide, cf. §8 du
 * spec) sans que ce package partagé ne dépende de Next.js.
 */
export type CarouselSlide = {
  id: string;
  alt: string;
};

/**
 * Les trois libellés d'accessibilité du carrousel.
 *
 * ⚠️ POURQUOI CETTE PROP EXISTE (2026-09-08, spec 30 §7d). Ils étaient en espagnol EN DUR. C'est
 * correct pour `apps/admin`, qui n'est pas localisé — mais `apps/web` sert es ET en, et un
 * visiteur anglophone au lecteur d'écran entendait « Foto siguiente » sur l'élément principal
 * d'une fiche. Aucune règle ni aucun test ne l'attrapait.
 *
 * OPTIONNELLE, avec les valeurs espagnoles d'origine en défaut : aucun appelant existant ne
 * change, et l'admin garde son comportement au caractère près.
 */
export type CarouselLabels = {
  anterior: string;
  siguiente: string;
  /** Reçoit le numéro de la photo (1-indexé). */
  irA: (n: number) => string;
};

const LABELS_POR_DEFECTO: CarouselLabels = {
  anterior: "Foto anterior",
  siguiente: "Foto siguiente",
  irA: (n) => `Ir a la foto ${n}`,
};

export type CarouselProps<T extends CarouselSlide> = {
  slides: T[];
  renderSlide: (slide: T, index: number) => React.ReactNode;
  /** "gallery" = dots + flèches (fiche produit/établissement) ; "hero" = flèches seules, plus grand. */
  variant?: "gallery" | "hero";
  /** Voir `CarouselLabels`. Omise → espagnol, le comportement d'origine. */
  labels?: CarouselLabels;
  className?: string;
};

export function Carousel<T extends CarouselSlide>({
  slides,
  renderSlide,
  variant = "gallery",
  labels = LABELS_POR_DEFECTO,
  className,
}: CarouselProps<T>) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const hasMultiple = slides.length > 1;

  React.useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!hasMultiple || !emblaApi) return;
    if (event.key === "ArrowLeft") emblaApi.scrollPrev();
    if (event.key === "ArrowRight") emblaApi.scrollNext();
  }

  if (slides.length === 0) return null;

  return (
    <div
      className={cn("relative", className)}
      data-testid="carousel"
      onKeyDown={handleKeyDown}
      tabIndex={hasMultiple ? 0 : undefined}
    >
      <div className="overflow-hidden rounded-md" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {slides.map((slide, index) => (
            <div className="w-full min-w-0 shrink-0 grow-0" key={slide.id} data-testid="carousel-slide">
              {renderSlide(slide, index)}
            </div>
          ))}
        </div>
      </div>

      {hasMultiple ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="absolute left-2 top-1/2 -translate-y-1/2"
            onPress={() => emblaApi?.scrollPrev()}
            aria-label={labels.anterior}
            data-testid="carousel-prev"
          >
            ‹
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onPress={() => emblaApi?.scrollNext()}
            aria-label={labels.siguiente}
            data-testid="carousel-next"
          >
            ›
          </Button>
        </>
      ) : null}

      {hasMultiple && variant === "gallery" ? (
        <div className="mt-2 flex justify-center gap-1.5" data-testid="carousel-dots">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={labels.irA(index + 1)}
              onClick={() => emblaApi?.scrollTo(index)}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                index === selectedIndex ? "bg-primary" : "bg-muted"
              )}
              data-testid="carousel-dot"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
