import type { MetadataRoute } from "next";
import { getSiteUrl, isProductionSite } from "@/lib/seo/siteUrl";

// DÉCISION Jérôme 2026-09-01 : TOUS les crawlers IA sont autorisés en production — GPTBot,
// ClaudeBot, Google-Extended, PerplexityBot, OAI-SearchBot, ChatGPT-User, CCBot… Pour Hifago,
// être cité comme source dans une réponse d'IA est de l'acquisition, pas du pillage.
//
// ⚠️ Cette décision se documente ICI, en commentaire, et NON par des groupes `User-Agent:` nommés
// dans le fichier servi. Un crawler n'obéit qu'au groupe le plus spécifique qui le nomme et
// IGNORE alors le groupe `*` : un groupe `User-Agent: GPTBot / Allow: /` qui ne répéterait pas
// les Disallow ci-dessous autoriserait GPTBot précisément là où le groupe générique l'interdit.
// Le groupe `*` en `Allow: /` suffit à tout autoriser (spec 26 §5.1).

/**
 * Routes sans aucun contenu indexable — exclues pour économiser le budget de crawl, jamais pour
 * empêcher une indexation (ça, c'est le rôle de `robots: { index: false }` en metadata : une page
 * en Disallow n'est jamais chargée, donc son noindex n'est jamais lu).
 *
 * `/{locale}/r/` : redirections d'attribution derrière les QR imprimés — sans contenu propre, et
 * chaque passage de crawler y fabrique une visite attribuée parasite.
 */
const DISALLOW = ["/es/r/", "/en/r/", "/auth/", "/api/"];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  // Rien n'est public tant que le déploiement ne se déclare pas « production » : une préprod
  // indexée cannibalise le vrai site. Aucun `sitemap:` n'est annoncé ici — on n'indique pas un
  // plan de site qu'on refuse par ailleurs de faire crawler.
  //
  // ⚠️ robots.txt est PRÉRENDU AU BUILD : basculer ce drapeau exige un REDÉPLOIEMENT, pas
  // seulement un changement de variable d'environnement.
  if (!isProductionSite()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
