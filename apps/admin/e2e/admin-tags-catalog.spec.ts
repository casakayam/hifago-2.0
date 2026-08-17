import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — Eliminar retiré de la liste
// (décision Jérôme), reste uniquement sur la fiche /admin/tags/[id] : le parcours passe désormais
// par "Ver" avant de pouvoir supprimer.
test("admin crée une etiqueta depuis /admin/tags, puis la supprime depuis sa fiche", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const tagLabel = `Etiqueta E2E ${Date.now()}`;
  await page.goto("/admin/tags");

  await page.getByTestId("new-tag-input").fill(tagLabel);
  await page.getByTestId("create-tag-button").click();

  const row = page.locator("tr", { hasText: tagLabel });
  await expect(row).toBeVisible();
  await expect(row).toContainText("0");
  await expect(row.getByText("Eliminar")).toHaveCount(0);

  await row.getByTestId(/^tag-detail-link-/).click();
  await expect(page.getByTestId("tag-detail-label")).toHaveText(tagLabel);
  // /admin/tags/[id] est une route neuve : au tout premier accès, Next.js dev-mode la compile à
  // la demande (badge "Compiling…" visible) après que le HTML server-rendu soit déjà là — le
  // libellé s'affiche avant que le bundle client (DeleteTagButton) ait fini de s'hydrater. Cliquer
  // trop tôt laisse le bouton visuellement actionnable mais sans handler encore attaché.
  await page.waitForLoadState("networkidle");

  await page.getByTestId(/^delete-tag-/).click();
  await page.getByTestId(/^confirm-delete-tag-/).click();

  await expect(page).toHaveURL(/\/admin\/tags$/);
  await expect(page.locator("tr", { hasText: tagLabel })).toHaveCount(0);
});
