import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { routing } from "@/i18n/routing";
import { CartProvider } from "@/lib/cart/CartContext";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: Omit<LayoutProps<"/[locale]">, "children">,
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "LocaleLayout" });
  return {
    // Sans metadataBase, TOUT `alternates.canonical` / `openGraph.url` relatif du site reste
    // relatif (next/dist/lib/metadata/default-metadata.js pose `metadataBase: null`, et
    // resolve-url.js ne résout en absolu que s'il est renseigné). Les canonicals des fiches
    // produit/établissement existaient déjà et étaient donc inertes. Posé ici parce que ce
    // layout est le root layout de fait — apps/web n'a pas de app/layout.tsx.
    metadataBase: new URL(getSiteUrl()),
    title: t("title"),
  };
}

export default async function PublicLocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      data-theme="vitrine"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <NextIntlClientProvider>
          <CartProvider>{children}</CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
