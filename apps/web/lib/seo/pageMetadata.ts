import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

const SITE_NAME = "Hifago";

// OpenGraph attend une locale au format `langue_TERRITOIRE`. Le marché est la Colombie — c'est
// la seule ville servie aujourd'hui (Guatapé), pas une généralisation.
const OG_LOCALE: Record<string, string> = { es: "es_CO", en: "en_US" };

/**
 * Métadonnées de route localisée : canonical, hreflang, indexabilité et OpenGraph, d'un seul
 * endroit.
 *
 * Partagé par l'accueil et les deux fiches parce que ces quatre choses se décident ENSEMBLE :
 * une page non traduite doit à la fois être `noindex`, pointer son canonical vers la langue
 * source, et ne pas s'annoncer comme une version linguistique distincte. Les écrire séparément
 * page par page est exactement ce qui avait produit l'incohérence existante entre la fiche
 * produit (qui portait `languages`) et la page établissement (qui n'en portait pas).
 *
 * Les chemins restent RELATIFS : `metadataBase` (app/[locale]/layout.tsx) les résout en absolu.
 *
 * @param nativeLocales locales où le contenu est réellement saisi. Par défaut toutes : c'est le
 *   cas des pages dont le texte vient de next-intl (jeu fermé et complet), par opposition au
 *   contenu partenaire soumis au repli JSONB.
 */
export function buildPageMetadata({
  locale,
  pathFor,
  title,
  description,
  nativeLocales = routing.locales,
  openGraphType = "website",
}: {
  locale: string;
  pathFor: (locale: string) => string;
  title: string;
  description?: string;
  nativeLocales?: readonly string[];
  openGraphType?: "website" | "article";
}): Metadata {
  // x-default désigne l'espagnol dès qu'il est servi (hifago/CLAUDE.md §5.4) ; à défaut, la seule
  // langue d'interface réellement traduite ; à défaut de tout, l'espagnol reste la langue source.
  const xDefault = nativeLocales.includes(routing.defaultLocale)
    ? routing.defaultLocale
    : (nativeLocales[0] ?? routing.defaultLocale);

  const isNative = nativeLocales.includes(locale);
  // Une page servie en repli n'est jamais une page distincte : son canonical désigne la langue
  // source, et elle reste `noindex` tant qu'aucune traduction réelle n'existe (§5.3).
  const canonical = pathFor(isNative ? locale : xDefault);

  // hreflang UNIQUEMENT sur les locales d'interface routées ET réellement traduites (§5.2) —
  // jamais sur la liste dynamique des langues de contenu.
  const languages: Record<string, string> = {};
  for (const candidate of nativeLocales) {
    languages[candidate] = pathFor(candidate);
  }
  languages["x-default"] = pathFor(xDefault);

  return {
    title,
    description,
    robots: isNative ? undefined : { index: false, follow: true },
    alternates: { canonical, languages },
    openGraph: {
      type: openGraphType,
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale] ?? OG_LOCALE[routing.defaultLocale],
      url: canonical,
      title,
      description,
    },
    twitter: { card: "summary" },
  };
}
