import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createTestUser, withDb } from "@hifago/e2e-support";

// Spec 35 — pilote réellement `/cuenta/perfil` : édition du profil, puis suppression de compte.
//
// CE QUE CES DEUX SPECS TIENNENT, et rien d'autre : le parcours d'écran ET la persistance réelle
// en base après la suppression (email neutralisé, profil vidé) — c'est le seul endroit du projet
// où ces deux faits se rencontrent dans une vraie requête HTTP, un Route Handler réel et l'API
// Admin Supabase réelle (aucun mock de ce côté, contrairement à `route.test.ts`). Les refus
// (session anonyme, email qui ne correspond pas, capacité professionnelle) sont prouvés en base et
// en composant, cent fois moins cher : `delete_my_account.test.sql`, `route.test.ts`,
// `DeleteAccountSection.test.tsx`.
test("un client édite son profil, puis supprime son compte — email libéré, orders intactes s'il y en avait", async ({
  page,
  context,
}) => {
  const email = `e2e-perfil-${Date.now()}@test.local`;
  const password = "Seed1234!";
  const userId = await createTestUser(email, password);

  await loginAs(context, email, password);
  await page.goto("/es/cuenta/perfil");

  // ① Profil vide au départ — ce compte n'a jamais rien édité ni commandé.
  await expect(page.getByTestId("profile-full-name-input")).toHaveValue("");

  // ② Édition, persistée en base — pas seulement à l'écran.
  await page.getByTestId("profile-full-name-input").fill("Cliente E2E Perfil");
  await page.getByTestId("profile-phone-input").fill("3001234567");
  await page.getByTestId("profile-save-button").click();
  await expect(page.getByTestId("profile-save-success")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("profile-full-name-input")).toHaveValue("Cliente E2E Perfil");

  // ③ Suppression : la confirmation exige l'email exact avant tout envoi réseau.
  await page.getByTestId("delete-account-button").click();
  await page.getByTestId("delete-account-email-input").fill("mauvais@test.local");
  await page.getByTestId("delete-account-confirm-yes").click();
  await expect(page.getByTestId("delete-account-mismatch")).toBeVisible();

  await page.getByTestId("delete-account-email-input").fill(email);
  await page.getByTestId("delete-account-confirm-yes").click();

  // ④ Redirigé, déconnecté — la zone compte redevient inaccessible avec l'ancienne session.
  await page.waitForURL(/\/es\/?$/);
  await page.goto("/es/cuenta/perfil");
  await page.waitForURL(/\/es\/entrar/);

  // ⑤ LE POINT DU LOT, EN BASE RÉELLE : profil vidé, email neutralisé (décision ⑤ — l'ancien email
  // n'appartient plus à personne). `auth.identities` aussi, sinon l'ancien email resterait « pris »
  // aux yeux de GoTrue malgré `auth.users.email` changé — vérifié ici, pas supposé.
  const { profil, identite } = await withDb(async (client) => {
    const { rows: profilRows } = await client.query(
      "select full_name, phone, partner_id from partner_accounts where id = $1",
      [userId]
    );
    const { rows: userRows } = await client.query("select email from auth.users where id = $1", [
      userId,
    ]);
    const { rows: identityRows } = await client.query(
      "select identity_data->>'email' as email from auth.identities where user_id = $1",
      [userId]
    );
    return {
      profil: { ...profilRows[0], email: userRows[0]?.email },
      identite: identityRows[0]?.email,
    };
  });

  expect(profil.full_name).toBeNull();
  expect(profil.phone).toBeNull();
  expect(profil.partner_id).toBeNull();
  expect(profil.email).toBe(`deleted+${userId}@hifago.invalid`);
  expect(identite).toBe(`deleted+${userId}@hifago.invalid`);
});

test("un compte professionnel ne peut pas se supprimer depuis l'écran client", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.referentActif, SEEDED_PASSWORD);
  await page.goto("/es/cuenta/perfil");

  // Le bouton n'existe même pas — décision ⑪, désactivé AVANT tout clic, pas après un refus.
  await expect(page.getByTestId("delete-blocked-capability")).toBeVisible();
  await expect(page.getByTestId("delete-account-button")).toHaveCount(0);
});
