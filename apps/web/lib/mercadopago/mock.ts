import { isProductionSite } from "@/lib/seo/siteUrl";

// Mode dev — émule un paiement Mercado Pago réussi/échoué en local, sans identifiant ni appel
// réseau externe. Double verrou volontaire, même discipline que MERCADOPAGO_WEBHOOK_SECRET qui
// « refuse tout » s'il manque : le flag seul ne suffit jamais à activer le mock sur un déploiement
// de production, même posé par erreur. Réutilise isProductionSite() (apps/web/lib/seo/siteUrl.ts)
// plutôt que de redupliquer le check VERCEL_ENV — c'est déjà l'unique détecteur de prod du monorepo.
export function isPaymentsMockEnabled(): boolean {
  return process.env.MERCADOPAGO_MOCK_MODE === "true" && !isProductionSite();
}
