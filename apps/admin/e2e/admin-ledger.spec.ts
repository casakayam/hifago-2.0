import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { createSignedInClient } from "@hifago/e2e-support";
import { slugify } from "../lib/utils";

// Spec 19 §0 Tranche 0 (Admin : ledger de règlement) — parcours écran. La logique de
// mark_ledger_entry_paid elle-même (non-admin, motif obligatoire, entrée introuvable/déjà traitée,
// comprobante/note/paid_at, audit_log) est déjà entièrement couverte par pgTAP
// (supabase/tests/database/ledger_entries.test.sql) — pas re-prouvée ici, seul le parcours écran
// l'est. Même patron que admin-reconciliation.spec.ts (feature 22).
//
// Fixture DÉDIÉE (jamais une entrée seedée partagée) : ce test MUTE l'état d'une ledger_entries
// (due → paid), donc jamais rejouable proprement sur un enregistrement partagé — leçon du
// protocole multi-agents (AGENTS-PARALLELES.md point 5), reproduite ici en pratique à deux reprises
// lors de l'écriture de ce test : (1) un premier essai sur une entrée seedée partagée a cassé au
// second run (mutation persistante, contrairement à pgTAP qui rollback) ; (2) un second essai avec
// SEED-DEMO-REF (référent "Prestador Propuestas Org", b0000000-...-0003) a pollué les TOTAUX
// agrégés de partner-commissions.spec.ts, qui vérifie ce même référent — attribution basculée sur
// SEED-REFACTIVE (référent "Référent Actif Org", a0000000-...-0002/SEED-REFACTIVE, compte
// entièrement distinct) pour une isolation complète. Construite via create_order sur un produit
// fraîchement créé, propriétaire différent (établissement Casa Kayam Guatapé, b0000000-...-0002)
// — puis set_order_line_status('fulfilled') pour faire passer la créance référent à 'due',
// exactement le chemin réel (jamais un insert direct : ledger_entries est RPC-only).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000002";

test("admin marque une créance référent payée depuis /admin/ledger avec un motif, elle rejoint l'historique", async ({
  page,
}) => {
  const stamp = Date.now();
  const productName = `Actividad Ledger E2E ${stamp}`;
  const holderName = `Cliente Ledger E2E ${stamp}`;
  const date = "2027-01-15"; // loin de toute date déjà réservée par d'autres specs, produit dédié de toute façon.

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  const { data: establishment } = await adminClient
    .from("establishments")
    .select("partner_id")
    .eq("id", ESTABLISHMENT_ID)
    .single();
  if (!establishment) {
    throw new Error("e2e setup: établissement introuvable");
  }

  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: establishment.partner_id,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: productName },
      price_cop: 80000,
      sellable: true,
      slug: slugify(productName),
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  const { data: availabilityResult, error: availabilityError } = await adminClient.rpc(
    "set_product_availability",
    { p_product_id: product.id, p_date: date, p_capacity: 5, p_open: true }
  );
  if (availabilityError || !(availabilityResult as { ok: boolean } | null)?.ok) {
    throw new Error(
      `e2e setup: ouverture de la disponibilité a échoué : ${availabilityError?.message ?? JSON.stringify(availabilityResult)}`
    );
  }

  const { data: orderResult, error: orderError } = await adminClient.rpc("create_order", {
    p_lines: [{ product_id: product.id, date, qty: 1 }],
    p_holder_name: holderName,
    p_holder_email: `cliente.ledger.e2e.${stamp}@example.com`,
    p_attribution_code: "SEED-REFACTIVE",
    p_attribution_source: "link",
  });
  if (orderError || !(orderResult as { ok: boolean } | null)?.ok) {
    throw new Error(
      `e2e setup: create_order a échoué : ${orderError?.message ?? JSON.stringify(orderResult)}`
    );
  }
  const orderId = (orderResult as { order_id: string }).order_id;

  const { data: orderLine } = await adminClient
    .from("order_lines")
    .select("id, commission_case")
    .eq("order_id", orderId)
    .single();
  if (!orderLine || orderLine.commission_case !== "external_referrer") {
    throw new Error(
      `e2e setup: ligne inattendue (commission_case=${orderLine?.commission_case}) — attribution externe requise`
    );
  }

  const { data: fulfillResult, error: fulfillError } = await adminClient.rpc("set_order_line_status", {
    p_order_line_id: orderLine.id,
    p_new_status: "fulfilled",
    p_reason: "Setup e2e — client confirmé",
  });
  if (fulfillError || !(fulfillResult as { ok: boolean } | null)?.ok) {
    throw new Error(
      `e2e setup: set_order_line_status a échoué : ${fulfillError?.message ?? JSON.stringify(fulfillResult)}`
    );
  }

  // --- Parcours écran réel -------------------------------------------------------------------
  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/ledger");

  const dueGroup = page.getByTestId("ledger-due-group");
  const entry = dueGroup.getByTestId("ledger-entry").filter({ hasText: holderName });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("Referente: Référent Actif Org");

  await entry.getByTestId("mark-paid-button").click();
  await page.waitForSelector('[data-testid="mark-paid-note-input"]');
  await page.getByTestId("mark-paid-comprobante-input").fill("comprobantes/e2e-test.pdf");
  await page.getByTestId("mark-paid-note-input").fill("Transferencia Bancolombia confirmada (e2e).");
  await page.getByTestId("confirm-mark-paid-button").click();

  // Mise à jour d'état local (pas de router.refresh(), cf. LedgerList.tsx) : l'entrée disparaît de
  // "Por pagar" et rejoint "Historial".
  await expect(dueGroup.getByTestId("ledger-entry").filter({ hasText: holderName })).toHaveCount(0);
  await expect(
    page.getByTestId("ledger-history-group").getByTestId("ledger-entry").filter({ hasText: holderName })
  ).toBeVisible();
});
