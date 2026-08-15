import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Établissement seedé par la feature 2 ("Casa Kayam Guatapé"), porte déjà une activité
// (le produit de démonstration Checkpoint B) — cf. plan feature 3 ("l'établissement créé en
// feature 2").
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002";

test("admin modifie le prix d'une activité et le voit sur la liste établissement", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  await page.goto("/admin/establishments");
  // Le compteur "N actividades" de la feature 2 est cliquable depuis cette feature.
  await page.getByTestId(`activity-count-${ESTABLISHMENT_ID}`).click();
  // Délai plus généreux que le défaut : première navigation vers cette route dynamique après
  // démarrage à froid des deux serveurs de dev (apps/web + apps/admin depuis la scission
  // monorepo), compilation Turbopack à la demande potentiellement plus longue que 5s ici.
  await expect(page).toHaveURL(new RegExp(`/admin/establishments/${ESTABLISHMENT_ID}$`), { timeout: 10000 });

  await page.getByRole("link", { name: /Tour en lancha/ }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit$/);

  // Prix varié par run pour éviter un faux positif si un run précédent avait déjà laissé
  // exactement cette valeur (la base locale n'est pas remise à zéro entre deux exécutions e2e).
  const newPrice = 90000 + (Date.now() % 1000);
  await page.locator('input[name="price"]').fill(String(newPrice));
  await page.getByTestId("save-product-button").click();

  await expect(page).toHaveURL(new RegExp(`/admin/establishments/${ESTABLISHMENT_ID}$`));

  const formattedPrice = new Intl.NumberFormat("es", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(newPrice);
  await expect(page.getByText(formattedPrice)).toBeVisible();
});
