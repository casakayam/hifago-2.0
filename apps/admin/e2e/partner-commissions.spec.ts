import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { formatCop } from "@hifago/domain";

// Feature 14 (Socio : dashboard de commissions) — "operador.propuestas" (SEEDED_ACCOUNTS) est le
// référent (partenaire b0000000-...-0003, "Prestador Propuestas Org") de 3 lignes seedées
// (supabase/seed.sql, features 9/11/12) : 2026-10-02 reserved (estimated), 2026-10-03 fulfilled
// (earned), 2026-10-04 cancelled_by_client (redistributed) — referrer_commission_cop = 16000/8000/
// 8000 respectivement. Aucune autre spec e2e ne réfère de ligne à ce partenaire (grep confirmé) :
// les totaux ci-dessous sont stables d'un run à l'autre, pas seulement au premier chargement.
test("un référent seedé voit sa liste de commissions et ses totaux corrects, la ligne annulée montre la part reprise", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/commissions");

  const estimated = formatCop(16000);
  const earned = formatCop(8000);
  const redistributed = formatCop(8000);

  // En-tête : 3 totaux agrégés, calculés côté client à partir des lignes déjà chargées.
  await expect(page.getByTestId("total-estimated")).toHaveText(estimated);
  await expect(page.getByTestId("total-earned")).toHaveText(earned);
  await expect(page.getByTestId("total-redistributed")).toHaveText(redistributed);

  // Ligne reserved (2026-10-02) → "Estimada".
  const estimatedRow = page.locator("tr", { hasText: "2026-10-02" });
  await expect(estimatedRow).toBeVisible();
  await expect(estimatedRow).toContainText("Estimada");
  await expect(estimatedRow.getByTestId(/^referrer-commission-/)).toHaveText(estimated);

  // Ligne fulfilled (2026-10-03) → "Ganada, por pagar" (jamais "pagada").
  const earnedRow = page.locator("tr", { hasText: "2026-10-03" });
  await expect(earnedRow).toBeVisible();
  await expect(earnedRow).toContainText("Ganada, por pagar");
  await expect(earnedRow.getByTestId(/^referrer-commission-/)).toHaveText(earned);

  // Ligne cancelled_by_client (2026-10-04) → "Reasignada al prestador" : la part référent
  // snapshotée reste visible (8000), pas simplement absente — le badge dit ce qui lui est arrivé.
  const redistributedRow = page.locator("tr", { hasText: "2026-10-04" });
  await expect(redistributedRow).toBeVisible();
  await expect(redistributedRow).toContainText("Reasignada al prestador");
  await expect(redistributedRow.getByTestId(/^referrer-commission-/)).toHaveText(redistributed);
});
