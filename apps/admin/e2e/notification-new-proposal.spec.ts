import { test, expect } from "@playwright/test";
import { createSignedInClient, purgeNotificationEmails, SEEDED_PASSWORD } from "@hifago/e2e-support";
import { SEEDED_ACCOUNTS } from "./support/login";

// Spec 23 Tranche 1 — chemin heureux "nouvelle proposition à modérer" : aucun écran admin dédié à
// notification_emails n'existe en v1 (spec 23 §2, pas d'action requise dessus contrairement à la
// réconciliation) — l'assertion se fait directement en base via le client admin (RLS déjà couverte
// par notification_emails_select_admin), même esprit que les assertions payments.status/
// ledger_entries des specs 19/20. Produit dédié à ce test (jamais l'établissement/produit partagé
// de la feature 15), fixture dédiée par nom affiché — cf. AGENTS-PARALLELES.md point 5.
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

test("soumettre une proposition met en file un email pour chaque admin actif", async () => {
  const suffix = Date.now();
  const productName = `Actividad Notification ${suffix}`;
  const slug = `notification-test-${suffix}`;

  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: productName },
      price_cop: 40000,
      category: "bienestar",
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  try {
    const socioClient = await createSignedInClient(SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
    const { data: submitResult, error: submitError } = await socioClient.rpc("submit_product_proposal", {
      p_product_id: product.id,
      p_payload: { name: { es: productName }, price_cop: 45000 },
    });
    if (submitError || !(submitResult as { ok: boolean } | null)?.ok) {
      throw new Error(`e2e setup: submit_product_proposal a échoué : ${submitError?.message}`);
    }
    const proposalId = (submitResult as { proposal_id: string }).proposal_id;

    const { data: notifications, error: notifError } = await adminClient
      .from("notification_emails")
      .select("recipient_email, status, subject")
      .eq("event_type", "admin_new_proposal")
      .eq("related_table", "product_proposals")
      .eq("related_id", proposalId);

    if (notifError) {
      throw new Error(`assertion e2e: lecture notification_emails a échoué : ${notifError.message}`);
    }

    expect(notifications ?? [], "au moins un admin actif notifié").not.toHaveLength(0);
    for (const row of notifications ?? []) {
      expect(row.status).toBe("pending");
      expect(row.subject).toContain("propuesta de producto");
    }

    await purgeNotificationEmails({ relatedTable: "product_proposals", relatedId: proposalId });
  } finally {
    await adminClient.from("products").delete().eq("id", product.id);
  }
});
