import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { formatOccurrenceLabel } from "@/lib/products/formatOccurrenceLabel";
import { formatCop } from "@hifago/domain";
import { Link } from "@/i18n/navigation";
import { Card, buttonVariants } from "@hifago/ui";
import { ReservationForm } from "./ReservationForm";
import { ProductPhotos } from "./ProductPhotos";

// Template literal sans interpolation (pas une concaténation "a" + "b"), une seule ligne : Supabase-js
// infère le type de retour de .select() en analysant le TYPE littéral de la chaîne au niveau
// TypeScript — une concaténation par + l'élargirait en simple `string`, perdant l'info nécessaire
// au parsing statique (constaté : tombe alors sur le type de repli GenericStringError). Une seule
// ligne, aussi, pour ne pas envoyer de retours à la ligne dans le paramètre select de PostgREST.
const PRODUCT_COLUMNS = `id, slug, name, description, price_cop, unit, type, price_label, external_booking_url, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, establishment:establishments(name)`;

const getProduct = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  return product;
});

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/products/[slug]">, "searchParams">
): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const product = await getProduct(slug);
  if (!product) return {};

  const title = resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug;
  const description =
    resolveLocalizedField(asLocalizedField(product.description), locale) ?? undefined;
  // Une fiche saisie sans traduction pour cette locale (repli JSONB, cf. hifago/CLAUDE.md §5)
  // reste noindex + canonical vers la langue source (es, la locale de repli de
  // resolveLocalizedField) tant qu'aucune vraie traduction n'existe — jamais indexée comme une
  // page distincte.
  const hasNativeContent = Boolean(asLocalizedField(product.name)?.[locale]);

  return {
    title,
    description,
    robots: hasNativeContent ? undefined : { index: false, follow: true },
    alternates: {
      canonical: hasNativeContent
        ? `/${locale}/products/${product.slug}`
        : `/es/products/${product.slug}`,
      // Uniquement les locales d'interface routées (es/en) — jamais la liste dynamique de
      // langues de contenu du produit (cf. hifago/CLAUDE.md §5.2).
      languages: {
        es: `/es/products/${product.slug}`,
        en: `/en/products/${product.slug}`,
      },
    },
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/[locale]/products/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ProductPage");
  const tOccurrence = await getTranslations("ProductPage.occurrence");
  const tCommon = await getTranslations("Common");

  const supabase = await createClient();
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  // Feature 21 : un evento vitrine n'a ni cupo ni panier — la disponibilité n'a aucun sens pour ce
  // type, jamais consultée (contrairement aux autres types, réservables via create_order).
  const isEvento = product.type === "evento";

  const { data: availability } = isEvento
    ? { data: [] }
    : await supabase
        .from("product_availability")
        .select("date, capacity, booked")
        .eq("product_id", product.id)
        .order("date");

  const { data: media } = await supabase
    .from("product_media")
    .select("id, storage_path")
    .eq("product_id", product.id)
    .order("sort", { ascending: true });

  const name = resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug;
  const description = resolveLocalizedField(asLocalizedField(product.description), locale);
  const establishmentName =
    resolveLocalizedField(asLocalizedField(product.establishment?.name), locale) ?? "";

  // price_label affiché tel quel pour un evento (texte libre, admin §3c) — jamais formaté en COP,
  // à la différence de price_cop pour tous les autres types.
  const priceDisplay = isEvento
    ? product.price_label
    : formatCop(product.price_cop ?? 0, locale);

  const occurrenceLabel = isEvento
    ? formatOccurrenceLabel(
        {
          occurrenceType: product.occurrence_type as "once" | "recurring" | null,
          occurrenceDate: product.occurrence_date,
          recurrenceFrequencyDays: product.recurrence_frequency_days,
          recurrenceEndDate: product.recurrence_end_date,
          recurrenceEndCount: product.recurrence_end_count,
        },
        locale,
        // Cast : le Translator scopé au namespace n'accepte que ses clés littérales, plus étroit
        // que OccurrenceTranslator (key: string) — cf. formatOccurrenceLabel.test.ts pour le même
        // besoin et sa justification complète.
        tOccurrence as unknown as (key: string, values?: Record<string, string | number>) => string
      )
    : null;

  const photoSlides = (media ?? []).map((m) => ({
    id: m.id,
    alt: name,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <Link href="/" className="text-sm text-muted hover:underline">
        {t("backToCatalog")}
      </Link>
      <Card>
        <Card.Header>
          <Card.Title className="text-2xl" data-testid="product-name">
            {name}
          </Card.Title>
          {description ? <Card.Description>{description}</Card.Description> : null}
        </Card.Header>
        <Card.Content className="flex flex-col gap-6">
          <ProductPhotos slides={photoSlides} />

          <p className="text-lg font-medium" data-testid="product-price">
            {priceDisplay}
            {!isEvento && product.unit === "per_person" ? (
              <span className="ml-1 text-sm font-normal text-muted">
                {t("perPerson")}
              </span>
            ) : null}
          </p>

          {isEvento ? (
            <div className="flex flex-col gap-3">
              {occurrenceLabel ? (
                <p data-testid="evento-occurrence" className="text-sm text-muted">
                  {occurrenceLabel}
                </p>
              ) : null}
              {product.external_booking_url ? (
                <a
                  href={product.external_booking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="evento-reserve-link"
                  className={buttonVariants({ variant: "primary" })}
                >
                  {t("reserveExternal")}
                </a>
              ) : null}
            </div>
          ) : (
            <ReservationForm
              productId={product.id}
              productName={name}
              establishmentName={establishmentName}
              priceCop={product.price_cop ?? 0}
              availability={availability ?? []}
            />
          )}

          <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>
        </Card.Content>
      </Card>
    </main>
  );
}
