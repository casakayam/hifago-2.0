import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Feature 25 (Admin : audiences serveur + moteur de campagne) — "Cliente Campaign Consent Seed"/
// "Cliente Campaign No Consent Seed" (supabase/seed.sql) sont 2 comptes clients ENREGISTRÉS dédiés
// (jamais des invités : list_audience_members ne voit que les comptes avec une ligne
// partner_accounts) avec une commande la plus récente à consentement true/false respectivement —
// garantit une vraie répartition envoyé/ignoré sur l'audience 'clients', quels que soient les
// autres comptes enregistrés ayant aussi commandé au fil d'autres specs e2e (reserve.spec.ts,
// etc.) — les assertions ci-dessous restent volontairement des bornes ("au moins 1"), pas des
// comptes exacts, pour rester robustes à ce bruit réel.
test("admin crée une campagne sur l'audience clients, voit la bannière Habeas Data, traite un lot, les compteurs se répartissent", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/campaigns/new");

  // Audience 'clients', explicitement sélectionnée (même si déjà la valeur par défaut) — la
  // bannière Habeas Data doit être visible dès qu'elle inclut des clients.
  await page.getByTestId("audience-select").click();
  await page.getByRole("option", { name: "Clientes" }).click();
  await expect(page.getByTestId("habeas-data-warning")).toBeVisible();

  await page.getByTestId("channel-select").click();
  await page.getByRole("option", { name: "WhatsApp" }).click();

  const stamp = Date.now();
  await page
    .getByTestId("message-template-input")
    .fill(`Hola, tenemos novedades para ti — campaña e2e ${stamp}.`);

  await page.getByTestId("create-campaign-button").click();
  await expect(page).toHaveURL(/\/admin\/campaigns\/.+/);

  // Avant traitement : au moins les 2 cibles seedées sont en attente, aucune n'est encore envoyée
  // ni ignorée pour consentement.
  const pendingBefore = await page.getByTestId("count-pending").textContent();
  expect(Number(pendingBefore)).toBeGreaterThan(0);
  await expect(page.getByTestId("count-sent")).toHaveText("0");
  await expect(page.getByTestId("count-skipped_no_consent")).toHaveText("0");

  await page.getByTestId("process-batch-button").click();
  await expect(page.getByTestId("last-batch-result")).toBeVisible();

  // count-pending atteignant "0" sert de barrière d'attente fiable (expect avec re-tentatives) :
  // router.refresh() est asynchrone, un simple .textContent() sur count-sent/count-skipped_no_consent
  // juste après le clic lirait le DOM avant que le rafraîchissement serveur n'ait eu lieu.
  await expect(page.getByTestId("count-pending")).toHaveText("0");

  // Répartition réelle après traitement : les 2 cibles seedées dédiées garantissent qu'au moins 1
  // de chaque ressort, prouvant que le filtrage de consentement fonctionne des deux côtés, pas
  // seulement "tout envoyé" ou "tout ignoré".
  const sentAfter = await page.getByTestId("count-sent").textContent();
  const noConsentAfter = await page.getByTestId("count-skipped_no_consent").textContent();
  expect(Number(sentAfter)).toBeGreaterThanOrEqual(1);
  expect(Number(noConsentAfter)).toBeGreaterThanOrEqual(1);

  // Le lot unique (batch_size=20 par défaut, largement suffisant à cette échelle) a tout traité :
  // la campagne passe à completed, le bouton se désactive.
  await expect(page.getByTestId("campaign-status")).toHaveText("Completada");
  await expect(page.getByTestId("process-batch-button")).toBeDisabled();
});
