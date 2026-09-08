"use client";

import Image from "next/image";
import { Carousel, type CarouselSlide } from "@hifago/ui";

// packages/ui reste indépendant de Next.js (§10 du spec) : ce composant branche next/image dans
// le Carousel partagé via renderSlide — seul le premier slide visible charge en priorité
// (`priority`), les suivants restent `loading="lazy"` (docs/specs/04-gestion-images.md §8, sinon
// régression LCP silencieuse une fois montés hors-écran par Embla).
export function ProductPhotos({ slides }: { slides: (CarouselSlide & { url: string })[] }) {
  if (slides.length === 0) return null;

  return (
    <Carousel
      slides={slides}
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
            sizes="(max-width: 640px) 100vw, 640px"
          />
        </div>
      )}
    />
  );
}
