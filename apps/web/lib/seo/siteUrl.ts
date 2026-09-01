// URL publique absolue de la vitrine, et drapeau d'ouverture du référencement.
//
// Réutilise NEXT_PUBLIC_WEB_APP_URL plutôt que d'introduire une variable de plus : apps/admin
// l'emploie déjà pour désigner exactement cette URL (apps/admin/.env.example, consommée par
// partner/(app)/tools/page.tsx pour le lien de parrainage socio), et la CI la pose. Elle n'était
// simplement pas encore posée côté apps/web.

/** Repli local — même valeur que WEB_APP_URL de @hifago/e2e-support et que `next dev -p 3100`. */
const LOCAL_FALLBACK = "http://localhost:3100";

/**
 * Origine absolue du site, sans barre oblique finale.
 *
 * Volontairement JAMAIS dérivée des en-têtes de la requête (x-forwarded-host), bien que
 * packages/domain/src/http/resolveOrigin.ts sache le faire : une URL canonique qui change avec
 * l'hôte servant la requête annule exactement ce que le canonical sert à résoudre — deux hôtes
 * produiraient deux canonicals pour la même page (spec 26 §10 point C).
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WEB_APP_URL?.trim();
  return (configured || LOCAL_FALLBACK).replace(/\/+$/, "");
}

/**
 * Vrai uniquement sur le déploiement de production. Seul ce prédicat ouvre robots.txt.
 *
 * Adossé à VERCEL_ENV et JAMAIS à l'URL configurée : sur Vercel, une variable définie
 * « All Environments » ferait émettre `Allow: /` depuis CHAQUE build de preview — précisément le
 * scénario que la décision « rien n'est public » veut empêcher (spec 26 §10 point A).
 */
export function isProductionSite(): boolean {
  return process.env.VERCEL_ENV === "production";
}
