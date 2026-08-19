import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";

// Même partenaire réutilisé par plusieurs specs produit (admin-product-photos.spec.ts,
// admin-product-tags.spec.ts), mais un établissement CRÉÉ ICI et jamais partagé : le sélectionner
// par son NOM dans le Select exige un nom stable — un établissement seedé partagé (ex. "b0000000-
// ...-004") peut être renommé entre-temps par un autre test (admin-establishment-edit.spec.ts,
// spec 06, mute son nom), cassant une sélection par nom même si son id reste valide pour un simple
// insert direct par FK.
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

test("admin crée une actividad avec paliers de prix et bornes de quantité ; create_order applique les bornes et résout le bon prix", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const productName = `Actividad Tramos E2E ${suffix}`;
  const establishmentName = `Establecimiento Tramos E2E ${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: establishment, error: establishmentError } = await adminClient
    .from("establishments")
    .insert({ partner_id: PARTNER_ID, name: { es: establishmentName } })
    .select("id")
    .single();
  if (establishmentError || !establishment) {
    throw new Error(`e2e setup: création de l'établissement a échoué : ${establishmentError?.message}`);
  }

  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/products/new");
  // Spec 11 — ProductForm est nettement plus lourd à hydrater que l'ancien NewProductForm
  // (galerie/crop, éditeur de créneaux, autocomplete d'adresse) : sans cette attente, la toute
  // première interaction sur la page peut atteindre le DOM avant que React n'ait attaché ses
  // gestionnaires (valeur/submit perdus silencieusement, jamais reçus par le state React).
  await page.waitForLoadState("networkidle");

  await page.locator('input[name="nombre"]').fill(productName);
  await page.getByTestId("establishment-select").click();
  await page.getByRole("option", { name: establishmentName }).click();
  // type reste "activity" (valeur par défaut du Select).

  await page.getByTestId("price-mode-toggle").click(); // "Definir por tramos"

  // Tramo 1 : [2, 3] → 30000. Tramo 2 : [5, 6] → 25000 (trou volontaire à 4, cf. assertions RPC).
  await page.getByTestId("price-tier-min-0").fill("2");
  await page.getByTestId("price-tier-max-0").fill("3");
  await page.getByTestId("price-tier-price-0").fill("30000");

  await page.getByTestId("add-price-tier-button").click();
  await page.getByTestId("price-tier-min-1").fill("5");
  await page.getByTestId("price-tier-max-1").fill("6");
  await page.getByTestId("price-tier-price-1").fill("25000");

  await page.getByTestId("min-qty-input").fill("2");
  await page.getByTestId("max-qty-input").fill("6");

  await page.getByTestId("create-product-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  const { data: product } = await adminClient
    .from("products")
    .select("id")
    .eq("name->>es", productName)
    .single();
  if (!product) throw new Error("e2e: produit introuvable après création via l'UI");
  const productId = product.id as string;

  const date = "2026-10-21"; // date dédiée à ce test
  await adminClient.rpc("set_product_availability", {
    p_product_id: productId,
    p_date: date,
    p_capacity: 50,
  });
  await adminClient.rpc("set_product_sellable", { p_product_id: productId, p_sellable: true });

  async function attemptOrder(qty: number) {
    const { data } = await adminClient.rpc("create_order", {
      p_lines: [{ product_id: productId, date, qty }],
      p_holder_name: `Cliente E2E Tramos ${suffix} qty${qty}`,
      p_holder_email: `cliente.tramos.${suffix}@example.com`,
    });
    return data as { ok: boolean; reason?: string; order_id?: string };
  }

  // Sous le minimum (2).
  expect((await attemptOrder(1)).reason).toBe("qty_below_minimum");
  // Au-dessus du maximum (6).
  expect((await attemptOrder(7)).reason).toBe("qty_cap_exceeded");
  // Dans les bornes mais dans le trou entre les deux tramos (3 < 4 < 5).
  expect((await attemptOrder(4)).reason).toBe("no_matching_tier");

  // Dans le premier tramo — résout 30000, pas price_cop (le prix simple n'a jamais été défini,
  // écrasé par lowestTierPrice = 25000 à la création — vérifié ci-dessous que ce n'est PAS ce
  // qui est facturé, c'est bien le tramo qui gagne).
  const first = await attemptOrder(2);
  expect(first.ok).toBe(true);
  const { data: firstLine } = await adminClient
    .from("order_lines")
    .select("price_cop")
    .eq("order_id", first.order_id as string)
    .single();
  expect(firstLine?.price_cop).toBe(30000);

  // Dans le second tramo — résout 25000.
  const second = await attemptOrder(5);
  expect(second.ok).toBe(true);
  const { data: secondLine } = await adminClient
    .from("order_lines")
    .select("price_cop")
    .eq("order_id", second.order_id as string)
    .single();
  expect(secondLine?.price_cop).toBe(25000);
});
