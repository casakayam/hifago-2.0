import { test, expect } from "@playwright/test";
import { toggleCheckbox } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// docs/specs/06-gestion-etablissement.md §5.1 — comble le gap cahier admin §3c (« toute la
// présentation d'un établissement s'édite depuis l'admin ») : avant cette feature, seules les
// photos étaient éditables après création (spec 04). Réutilise l'établissement seedé
// operador.propuestas (Feature 15) — édite ses champs, pas sa propriété, sans effet de bord sur
// les autres tests qui s'appuient sur cette même fixture (capacité/rattachement inchangés).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";

test("un admin édite un établissement existant (nom, descripción, dirección, opéré directement)", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const updatedName = `Hostal Editado ${Date.now()}`;

  await page.goto(`/admin/establishments/${ESTABLISHMENT_ID}`);

  const editBlock = page.getByTestId("establishment-edit-block");
  await expect(editBlock).toBeVisible();

  await page.locator("#edit-nombre").fill(updatedName);
  await toggleCheckbox(page.getByTestId("edit-operated-directly-checkbox"));

  await page.getByTestId("edit-description-textarea").fill("Descripción editada por el admin.");
  await page.getByTestId("edit-address-input").fill("Nueva Dirección 789, Guatapé");
  await page.getByTestId("edit-lat-input").fill("6.23");
  await page.getByTestId("edit-lon-input").fill("-75.16");

  await page.getByTestId("save-establishment-button").click();

  // Le succès n'est plus un texte inline dans la page mais un toast (docs/specs/16-notifications-
  // toast.md) — HeroUI rend chaque toast avec role="alertdialog", le message passé à
  // toast.success(...) devient son titre visible.
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Establecimiento actualizado." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: updatedName })).toBeVisible();

  // Reload : les valeurs persistées viennent bien de la base, pas seulement de l'état local du
  // formulaire juste après soumission.
  await page.reload();
  await expect(page.locator("#edit-nombre")).toHaveValue(updatedName);
  await expect(page.getByTestId("edit-description-textarea")).toHaveValue(
    "Descripción editada por el admin.",
  );
  await expect(page.getByTestId("edit-address-input")).toHaveValue("Nueva Dirección 789, Guatapé");
});
