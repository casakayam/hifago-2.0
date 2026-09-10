import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCartLines } from "@/lib/cart/getCartLines";
import { CartSummary } from "@/components/organisms/CartSummary";
import { LinkButton } from "@/components/atoms/LinkButton";
import type { Locale } from "@/messages";

// Spec 32 (panier en base) — route déjà prévue par la spec 27
// (`docs/specs/27-architecture-vitrine-et-routage.md:75`, « à créer »), jamais bâtie faute d'un
// panier qui survive assez longtemps pour mériter son propre écran. `SiteHeader.tsx` pointait vers
// `/pago` en l'attendant (`ROUTE_PANIER`, commentaire daté du 2026-09-02) — bascule dans ce même lot.
export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/carrito">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "CartPage" });
  // Panier propre à une session, rien d'indexable — même raisonnement que /pago (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function CartPage({ params }: PageProps<"/[locale]/carrito">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CartPage");
  const lines = await getCartLines(locale as Locale);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CartSummary lines={lines} editable locale={locale as Locale} />
      {lines.length > 0 ? (
        <LinkButton href="/pago" width="auto" testId="go-to-checkout">
          {t("goToCheckout")}
        </LinkButton>
      ) : null}
    </main>
  );
}
