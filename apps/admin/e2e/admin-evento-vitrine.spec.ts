import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { WEB_APP_URL } from "@hifago/e2e-support";

// Feature 21 (Admin : créer une fiche evento, vitrine) — parcours complet : création, publication
// (set_product_sellable, feature 4, réutilisée telle quelle), fiche publique. La logique des
// contraintes elle-même (fin de récurrence mutuellement exclusive, price_cop conditionnel) est
// déjà entièrement couverte par pgTAP (supabase/tests/database/products_evento.test.sql), pas
// re-prouvée ici.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002"; // Casa Kayam Guatapé (seed.sql)

test("admin crée un evento récurrent vitrine, le publie, la fiche publique affiche l'occurrence et le lien externe — jamais de bouton d'ajout au panier", async ({
  page,
}) => {
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const productName = `Feria Nautica E2E ${Date.now()}`;

  await page.goto(`/admin/products/new?establishment=${ESTABLISHMENT_ID}`);
  await page.waitForSelector('[data-testid="create-product-button"]');

  await page.locator("#name-es").fill(productName);
  await page.getByTestId("type-select").click();
  await page.getByRole("option", { name: "Evento (vitrina)" }).click();

  // price_cop masqué pour ce type, price_label le remplace.
  await expect(page.locator("#price")).toHaveCount(0);
  await page.getByTestId("price-label-input").fill("Entrada gratuita");

  // Récurrence structurée : tous les 7 jours, fin laissée "Indefinida" (valeur par défaut du
  // sélecteur) — la 3e condition de fin, aucune des deux posée.
  await page.getByTestId("occurrence-type-select").click();
  await page.getByRole("option", { name: "Recurrente" }).click();
  await page.getByTestId("recurrence-frequency-input").fill("7");

  await page.getByTestId("external-booking-url-input").fill("https://example.com/reservar");
  await page.getByTestId("create-product-button").click();
  await page.waitForURL(/\/admin\/establishments$/);

  // Publier — set_product_sellable (feature 4), réutilisée telle quelle, aucune RPC nouvelle ici.
  await page.goto(`/admin/establishments/${ESTABLISHMENT_ID}`);
  const row = page.locator("tr", { hasText: productName });
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(1)).toHaveText("—"); // price_cop null → "—", pas un montant COP
  await row.locator("a").first().click();
  await page.waitForURL(/\/admin\/products\/.+\/edit/);
  await page.getByTestId("toggle-sellable-button").click();
  await expect(page.getByTestId("product-status-badge")).toHaveText("Vendible");

  // Fiche publique — navigation réelle depuis le catalogue (le slug n'est jamais connu à l'avance
  // côté test, généré côté serveur à la création).
  await page.goto(`${WEB_APP_URL}/es`);
  await page.getByText(productName).click();

  await expect(page.getByTestId("product-name")).toHaveText(productName);
  // price_label affiché tel quel, jamais formaté en COP.
  await expect(page.getByTestId("product-price")).toHaveText("Entrada gratuita");
  await expect(page.getByTestId("evento-occurrence")).toHaveText(
    "Cada 7 días, de forma indefinida."
  );
  await expect(page.getByTestId("evento-reserve-link")).toHaveAttribute(
    "href",
    "https://example.com/reservar"
  );

  // Assertion négative explicite : aucun bouton d'ajout au panier n'est jamais rendu pour ce type
  // — un evento vitrine n'entre jamais dans create_order.
  await expect(page.getByTestId("add-to-cart-button")).toHaveCount(0);
});
