import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { formatCop } from "@hifago/domain";

// Feature 14 (Socio : dashboard de commissions), rebranché sur le vrai ledger_entries en spec 19
// §0 Tranche 0 (2026-08-18) — "operador.propuestas" (SEEDED_ACCOUNTS) est le référent (partenaire
// b0000000-...-0003, "Prestador Propuestas Org") de 4 lignes seedées (supabase/seed.sql, features
// 9/11/12 + spec 19) : 2026-10-02 reserved→estimated, 2026-10-03 fulfilled→due, 2026-10-04
// cancelled_by_client→void (+ compensation établissement, invisible ici), 2026-10-05 fulfilled,
// réglé→paid — referrer_commission_cop = 16000/8000/8000/8000 respectivement. Aucune autre spec
// e2e ne réfère de ligne à ce partenaire (grep confirmé) : les totaux ci-dessous sont stables d'un
// run à l'autre, pas seulement au premier chargement.
test("un référent seedé voit sa liste de commissions et ses totaux corrects, la ligne annulée montre la part reprise, une ligne réglée montre Pagada", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  await page.goto("/partner/commissions");

  const estimated = formatCop(16000);
  const due = formatCop(8000);
  const paid = formatCop(8000);
  const voidTotal = formatCop(8000);

  // En-tête : 4 totaux agrégés, calculés côté client à partir des lignes déjà chargées.
  await expect(page.getByTestId("total-estimated")).toHaveText(estimated);
  await expect(page.getByTestId("total-earned")).toHaveText(due);
  await expect(page.getByTestId("total-paid")).toHaveText(paid);
  await expect(page.getByTestId("total-redistributed")).toHaveText(voidTotal);

  // Ligne reserved (2026-10-02) → "Estimada".
  const estimatedRow = page.locator("tr", { hasText: "2026-10-02" });
  await expect(estimatedRow).toBeVisible();
  await expect(estimatedRow).toContainText("Estimada");
  await expect(estimatedRow.getByTestId(/^referrer-commission-/)).toHaveText(estimated);

  // Ligne fulfilled non réglée (2026-10-03) → "Ganada, por pagar" (jamais "Pagada").
  const dueRow = page.locator("tr", { hasText: "2026-10-03" });
  await expect(dueRow).toBeVisible();
  await expect(dueRow).toContainText("Ganada, por pagar");
  await expect(dueRow.getByTestId(/^referrer-commission-/)).toHaveText(due);

  // Ligne cancelled_by_client (2026-10-04) → "Reasignada al prestador" : la part référent
  // snapshotée reste visible (8000), pas simplement absente — le badge dit ce qui lui est arrivé.
  const voidRow = page.locator("tr", { hasText: "2026-10-04" });
  await expect(voidRow).toBeVisible();
  await expect(voidRow).toContainText("Reasignada al prestador");
  await expect(voidRow.getByTestId(/^referrer-commission-/)).toHaveText(voidTotal);

  // Ligne fulfilled déjà réglée (2026-10-05) → "Pagada" — état que l'ancienne dérivation
  // (deriveLedgerEntry) ne pouvait structurellement jamais produire, seul le vrai ledger le peut.
  const paidRow = page.locator("tr", { hasText: "2026-10-05" });
  await expect(paidRow).toBeVisible();
  await expect(paidRow).toContainText("Pagada");
  await expect(paidRow.getByTestId(/^referrer-commission-/)).toHaveText(paid);
});
