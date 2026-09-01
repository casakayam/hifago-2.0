import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { getSiteUrl } from "@/lib/seo/siteUrl";
import { createPublicClient } from "@/lib/supabase/publicClient";

// ⚠️ OBLIGATOIRE, et ce n'est pas une optimisation. Les metadata routes sont compilées en un
// `GET()` PRÉRENDU AU BUILD (next-metadata-route-loader, `initialRevalidateSeconds: false`) :
// sans cette directive le sitemap serait figé au moment du build — l'inverse exact du « sitemap
// dynamique » de hifago/CLAUDE.md §5.5. `revalidate` ne suffirait pas : le premier rendu se
// ferait quand même au build, et un sitemap faux serait servi jusqu'à la première revalidation.
//
// ⚠️ Le piège qui rend l'erreur SILENCIEUSE : le job `build` de la CI n'a aucun Supabase, et
// postgrest-js avale l'erreur réseau en `{ data: null }` au lieu de la lever. Un sitemap vide
// serait donc produit et livré sans qu'aucun build n'échoue. Aucun test unitaire ne protège de
// ça (un mock rend toujours des données) : le garde-fou est le smoke test de bascule,
// `curl <site>/sitemap.xml | grep -c "<loc>"` (spec 26 §5.2).
export const dynamic = "force-dynamic";

/** Ce que le sitemap a besoin de savoir d'une entité publiable. */
type PublishableRow = { slug: string; name: unknown; updated_at: string };

/**
 * Une entrée PAR LOCALE disposant d'un contenu réellement traduit, et non une seule entrée
 * espagnole portant ses alternates.
 *
 * Deux raisons, toutes deux constatées :
 *  - ne lister que `/es/…` priverait les URL `/en/…` de `<loc>` propre, motif classique de
 *    « hreflang : pas de balise de retour » en Search Console ;
 *  - un produit dont le `name` n'existe qu'en `en` a une page `/es` en `noindex` (§5.3) et une
 *    page `/en` parfaitement indexable : une entrée unique « es + alternates » la perdrait.
 *
 * Et jamais d'URL non indexable : le sitemap applique le MÊME prédicat que les
 * `generateMetadata`, sans quoi il listerait des pages que les métadonnées déclarent `noindex`.
 */
function localizedEntries(
  rows: PublishableRow[],
  pathFor: (locale: string, slug: string) => string,
  siteUrl: string
): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const row of rows) {
    const nativeLocales = routing.locales.filter((locale) => hasNativeContent(row.name, locale));
    if (nativeLocales.length === 0) continue;

    // x-default désigne l'espagnol dès qu'il est natif (§5.4) ; à défaut, la seule langue
    // d'interface réellement servie — jamais une URL qu'on vient de déclarer non indexable.
    const xDefault = nativeLocales.includes(routing.defaultLocale)
      ? routing.defaultLocale
      : nativeLocales[0];

    const languages: Record<string, string> = {};
    for (const locale of nativeLocales) {
      languages[locale] = `${siteUrl}${pathFor(locale, row.slug)}`;
    }
    languages["x-default"] = `${siteUrl}${pathFor(xDefault, row.slug)}`;

    for (const locale of nativeLocales) {
      entries.push({
        url: `${siteUrl}${pathFor(locale, row.slug)}`,
        lastModified: row.updated_at,
        alternates: { languages },
      });
    }
  }

  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const supabase = createPublicClient();

  // RLS anon, jamais le service_role : `products_select_public` (sellable) et
  // `establishments_select_public` (status actif + au moins un produit vendable) font déjà le
  // filtrage — les `.eq()` ci-dessous ne font que le rendre explicite et lisible.
  // Colonnes vérifiées accordées à `anon` sur les deux tables (migrations 20260819110000 et
  // 20260827200000) : une colonne non accordée ferait échouer TOUTE la requête (§11.1).
  const [products, establishments] = await Promise.all([
    supabase.from("products").select("slug, name, updated_at").eq("sellable", true),
    supabase.from("establishments").select("slug, name, updated_at").eq("status", "active"),
  ]);

  if (products.error || establishments.error) {
    // Tracé plutôt que tu : un sitemap vide est indiscernable d'un catalogue vide côté sortie.
    console.error("[sitemap] lecture du catalogue échouée", {
      products: products.error?.message,
      establishments: establishments.error?.message,
    });
  }

  // L'accueil est servi dans les deux locales : ce sont des libellés d'INTERFACE (next-intl,
  // jeu fermé et complet), pas du contenu partenaire soumis au repli JSONB.
  const homeLanguages: Record<string, string> = {};
  for (const locale of routing.locales) {
    homeLanguages[locale] = `${siteUrl}/${locale}`;
  }
  homeLanguages["x-default"] = `${siteUrl}/${routing.defaultLocale}`;

  const home: MetadataRoute.Sitemap = routing.locales.map((locale) => ({
    url: `${siteUrl}/${locale}`,
    alternates: { languages: homeLanguages },
  }));

  return [
    ...home,
    ...localizedEntries(
      (products.data ?? []) as PublishableRow[],
      (locale, slug) => `/${locale}/products/${slug}`,
      siteUrl
    ),
    ...localizedEntries(
      (establishments.data ?? []) as PublishableRow[],
      (locale, slug) => `/${locale}/establishments/${slug}`,
      siteUrl
    ),
  ];
}
