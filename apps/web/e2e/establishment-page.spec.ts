import { test, expect } from "@playwright/test";
import { createSignedInClient, SEEDED_ACCOUNTS, SEEDED_PASSWORD, withDb } from "@hifago/e2e-support";

// T1 du modèle hébergement (spec 24 §4) — la page publique d'un établissement, qui n'existait pas.
//
// Ce qu'elle remplace, et pourquoi ce test compte : la cible retenue le 2026-08-26 supprime l'étage
// `products.type='hotel'`, dont la fiche produit est aujourd'hui le SEUL écran qui présente le lieu
// et regroupe ses chambres. Sans cette page, retirer l'étage laisserait un catalogue de chambres
// orphelines. Le test vérifie donc les deux moitiés du remplacement : la page existe et regroupe, et
// la fiche produit y renvoie.
//
// Établissement seedé, produit DÉDIÉ créé ici — la base locale n'est pas remise à zéro entre deux
// exécutions e2e (même précédent que partner-agenda/partner-reservations).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";

test("la page publique d'un établissement le présente, regroupe ses produits, et la fiche produit y renvoie", async ({
  page,
}) => {
  const stamp = Date.now();
  const productName = `Habitación Establecimiento E2E ${stamp}`;
  const productSlug = `habitacion-establecimiento-e2e-${stamp}`;

  const admin = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishment } = await admin
    .from("establishments")
    .select("id, slug, name, partner_id")
    .eq("id", ESTABLISHMENT_ID)
    .maybeSingle();
  if (!establishment?.slug) {
    throw new Error("e2e setup : l'établissement seedé n'a pas de slug — la migration T1 est-elle appliquée ?");
  }

  // Horaires et mode : posés en base plutôt que par l'écran admin (couvert ailleurs) — ce test
  // porte sur le rendu PUBLIC de ces champs, pas sur leur saisie.
  await withDb((client) =>
    client.query(
      "update establishments set check_in_time = '15:00', check_out_time = '11:00', mode = 'rooms' where id = $1",
      [ESTABLISHMENT_ID]
    )
  );

  const { error: insertError } = await admin.from("products").insert({
    partner_id: establishment.partner_id,
    establishment_id: ESTABLISHMENT_ID,
    type: "lodging",
    name: { es: productName },
    slug: productSlug,
    sellable: true,
    price_cop: 150000,
    capacity: 2,
    unit_count: 3,
    lodging_kind: "private",
  });
  if (insertError) throw new Error(`e2e setup : création du produit a échoué — ${insertError.message}`);

  try {
    // --- La page présente le lieu et regroupe ses produits -------------------------------------
    await page.goto(`/es/establishments/${establishment.slug}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("establishment-name")).toBeVisible();
    // Les horaires sont une propriété du LIEU, pas de chaque chambre : c'est tout l'intérêt de les
    // avoir remontés au niveau établissement.
    await expect(page.getByTestId("establishment-hours")).toContainText("15:00");
    await expect(page.getByTestId("establishment-hours")).toContainText("11:00");

    // `mode = 'rooms'` doit intituler la liste « Habitaciones » — « nos chambres » n'aurait aucun
    // sens pour un logement loué entier, et c'est précisément ce que `mode` sert à distinguer.
    const lodgings = page.getByTestId("establishment-lodgings");
    await expect(lodgings).toContainText("Habitaciones");
    await expect(lodgings).toContainText(productName);
    // Les faits de couchage repris de la fiche produit, avec le même vocabulaire prudent : le
    // nombre d'unités est un TOTAL, jamais ce qui reste libre ce soir.
    await expect(lodgings).toContainText("Habitación privada");
    await expect(lodgings).toContainText("3 en total");

    // --- La fiche produit renvoie vers l'établissement ------------------------------------------
    await page.goto(`/es/products/${productSlug}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("establishment-name").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/es/establishments/${establishment.slug}$`));

    // --- Un slug inconnu est un 404, jamais une page vide ---------------------------------------
    const missing = await page.goto("/es/establishments/no-existe-jamas-2026");
    expect(missing?.status()).toBe(404);
  } finally {
    await withDb((client) => client.query("delete from products where slug = $1", [productSlug]));
    await withDb((client) =>
      client.query(
        "update establishments set check_in_time = null, check_out_time = null, mode = null where id = $1",
        [ESTABLISHMENT_ID]
      )
    );
  }
});
