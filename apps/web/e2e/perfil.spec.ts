import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createTestUser, createSignedInClient, resetAvailability, seedDate, withDb } from "@hifago/e2e-support";

const TOUR_PRODUCT_ID = "b0000000-0000-4000-8000-000000000001"; // tour-lancha-guatape
const TOUR_DATE = seedDate(16); // dédiée à ce spec, disjointe des offsets déjà pris ailleurs

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

// Spec 35 Tranche 5 — décision ⑦ : le PROFIL fait foi pour le pré-remplissage du tunnel, la
// dernière commande n'est qu'un repli. Preuve que ça tient VRAIMENT, pas seulement « le profil
// est lu » : une commande PASSÉE porte un nom différent de celui du profil édité APRÈS elle — si
// le tunnel mélangeait les deux sources ou retombait par erreur sur la commande, ce test le verrait.
test("le pré-remplissage du tunnel suit le profil, jamais une commande plus ancienne", async ({
  page,
  context,
}) => {
  await resetAvailability(TOUR_PRODUCT_ID, TOUR_DATE, { capacity: 5, booked: 0 });

  const email = `e2e-pago-prefill-${Date.now()}@test.local`;
  const password = "Seed1234!";
  const userId = await createTestUser(email, password);

  // ① Une commande PASSÉE, avec un nom volontairement différent de ce que le profil portera —
  // dogfooding via create_order, jamais un insert brut (même discipline que mis-reservas.spec.ts).
  const setupClient = await createSignedInClient(email, password);
  await setupClient
    .from("cart_items")
    .insert([{ account_id: userId, product_id: TOUR_PRODUCT_ID, date: TOUR_DATE, qty: 1 }]);
  const { data: created, error: rpcError } = await setupClient.rpc("create_order", {
    p_holder_name: "Nombre De La Commande Antigua",
    p_holder_email: email,
    p_holder_phone: "+573009998888",
  });
  if (rpcError || !(created as { ok: boolean } | null)?.ok) {
    throw new Error(`e2e setup: create_order a échoué : ${rpcError?.message ?? JSON.stringify(created)}`);
  }

  // `create_order` vide `cart_items` (spec 32) : sans une SECONDE ligne, `/pago` ne rendrait aucun
  // formulaire (`lines.length > 0`) et ce spec ne testerait rien. Jamais soumise ici — seule la
  // présence du formulaire et son pré-remplissage sont sous test.
  await setupClient
    .from("cart_items")
    .insert([{ account_id: userId, product_id: TOUR_PRODUCT_ID, date: TOUR_DATE, qty: 1 }]);

  await loginAs(context, email, password);

  // ② Sans profil édité, le tunnel retombe sur cette commande — le repli fonctionne. Le téléphone
  // est réaffiché FORMATÉ par PhoneField (espaces insérés) : on vérifie les chiffres significatifs,
  // pas la chaîne E.164 brute stockée.
  await page.goto("/es/pago");
  await expect(page.locator('input[name="holder-name"]')).toHaveValue("Nombre De La Commande Antigua");
  await expect(page.locator('input[name="holder-phone"]')).toHaveValue(/9998888/);

  // ③ Le client édite son profil APRÈS cette commande, avec un nom ET un téléphone différents.
  await page.goto("/es/cuenta/perfil");
  await page.getByTestId("profile-full-name-input").fill("Nombre Del Perfil Nuevo");
  await page.getByTestId("profile-phone-input").fill("3001112222");
  await page.getByTestId("profile-save-button").click();
  await expect(page.getByTestId("profile-save-success")).toBeVisible();

  // ④ LE POINT DU LOT : le tunnel affiche désormais le PROFIL, pas la commande plus ancienne qui
  // porte pourtant un nom différent — la seule façon de le prouver est de les faire diverger.
  await page.goto("/es/pago");
  await expect(page.locator('input[name="holder-name"]')).toHaveValue("Nombre Del Perfil Nuevo");
  await expect(page.locator('input[name="holder-phone"]')).not.toHaveValue(/9998888/);
});
