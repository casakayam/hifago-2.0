"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Card } from "@hifago/ui";
import { Link } from "@/i18n/navigation";
import type { LodgingKind } from "@hifago/domain";
import { ProductPhotos } from "../../products/[slug]/ProductPhotos";

export type EstablishmentProduct = {
  id: string;
  slug: string;
  name: string;
  descriptionSnippet: string | null;
  type: string;
  lodgingKind: LodgingKind | null;
  capacity: number | null;
  unitCount: number | null;
  imageUrl: string | null;
};

// Le rendu de la page établissement (T1). Séparé du Server Component qui la nourrit, parce que ce
// dernier ne doit jamais importer depuis "@hifago/ui" (CLAUDE.md §11.16) — la contrainte est
// structurelle, pas stylistique.
export function EstablishmentDetailView({
  name,
  description,
  address,
  checkInTime,
  checkOutTime,
  mode,
  photoSlides,
  products,
  backToCatalogLabel,
}: {
  name: string;
  description: string | null;
  address: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  mode: string | null;
  photoSlides: { id: string; alt: string; url: string }[];
  products: EstablishmentProduct[];
  backToCatalogLabel: string;
}) {
  const t = useTranslations("EstablishmentPage");

  // `mode` dit comment le lieu se VEND, et ça change le titre de la liste : « nos chambres » n'a
  // aucun sens pour un logement loué entier (Bania Travel dans la v1). `null` — un établissement
  // qui ne vend que des activités — retombe sur un intitulé neutre plutôt que d'inventer une
  // nature d'hébergement.
  const lodgings = products.filter((p) => p.type === "lodging");
  const others = products.filter((p) => p.type !== "lodging");
  const lodgingTitle =
    mode === "whole_house" ? t("wholeHouseTitle") : mode === "rooms" ? t("roomsTitle") : t("lodgingsTitle");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-8">
      <Link href="/" className="text-sm text-muted hover:underline">
        {backToCatalogLabel}
      </Link>

      <Card>
        <Card.Header>
          <Card.Title className="text-2xl" data-testid="establishment-name">
            {name}
          </Card.Title>
          {address ? <Card.Description data-testid="establishment-address">{address}</Card.Description> : null}
        </Card.Header>
        <Card.Content className="flex flex-col gap-6">
          <ProductPhotos slides={photoSlides} />

          {description ? <p data-testid="establishment-description">{description}</p> : null}

          {/* Horaires : portés par le LIEU, pas par chaque chambre. Chaque moitié est facultative —
              un établissement peut n'avoir renseigné que l'arrivée, et la ligne entière disparaît
              s'il n'a rien renseigné du tout, plutôt que d'afficher un tiret orphelin. */}
          {checkInTime || checkOutTime ? (
            <p className="text-sm text-muted" data-testid="establishment-hours">
              {[
                checkInTime ? t("checkIn", { time: checkInTime.slice(0, 5) }) : null,
                checkOutTime ? t("checkOut", { time: checkOutTime.slice(0, 5) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </Card.Content>
      </Card>

      {lodgings.length > 0 ? (
        <section className="flex flex-col gap-3" data-testid="establishment-lodgings">
          <h2 className="text-lg font-medium">{lodgingTitle}</h2>
          {lodgings.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </section>
      ) : null}

      {others.length > 0 ? (
        <section className="flex flex-col gap-3" data-testid="establishment-activities">
          <h2 className="text-lg font-medium">{t("activitiesTitle")}</h2>
          {others.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </section>
      ) : null}

      {/* Un établissement sans aucun produit vendable est un cas réel — il vient d'être créé, ou
          tout son catalogue est retiré de la vente. La page reste valide et le dit, plutôt que de
          se terminer sur du vide sans explication. */}
      {products.length === 0 ? (
        <p className="text-sm text-muted" data-testid="establishment-empty">
          {t("noProducts")}
        </p>
      ) : null}
    </main>
  );
}

function ProductRow({ product }: { product: EstablishmentProduct }) {
  const t = useTranslations("EstablishmentPage");

  // Les faits de couchage sont repris de la fiche produit — même vocabulaire, mêmes réserves : le
  // nombre d'unités est un TOTAL (« en total »), jamais ce qui reste libre ce soir.
  const facts = [
    product.lodgingKind === "dorm"
      ? t("lodgingKindDorm")
      : product.lodgingKind === "private"
        ? t("lodgingKindPrivate")
        : product.lodgingKind === "whole_house"
          ? t("lodgingKindWholeHouse")
          : null,
    product.capacity !== null ? t("lodgingCapacity", { count: product.capacity }) : null,
    product.unitCount !== null ? t("lodgingUnitCount", { count: product.unitCount }) : null,
  ].filter(Boolean);

  return (
    <Link href={`/products/${product.slug}`} className="block" data-testid="establishment-product">
      <Card className="transition hover:border-accent">
        <Card.Content className="flex flex-row items-center gap-4 p-4">
          {product.imageUrl ? (
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
              <Image src={product.imageUrl} alt={product.name} fill className="object-cover" loading="lazy" />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="font-medium">{product.name}</span>
            {facts.length > 0 ? (
              <span className="text-xs text-muted">{facts.join(" · ")}</span>
            ) : null}
            {product.descriptionSnippet ? (
              <span className="text-sm text-muted">{product.descriptionSnippet}</span>
            ) : null}
          </div>
        </Card.Content>
      </Card>
    </Link>
  );
}
