import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { webProductUrl, createSignedInClient } from "@hifago/e2e-support";

// Établissement/partenaire seedés par la feature 15 (operador.propuestas@hifago.test, la seule
// capacité operator ACTIVE et scopée à un establishment_id précis) — réutilisés pour rattacher un
// produit fraîchement créé à ce test, plutôt que de toucher au produit déjà seedé de la feature 15
// (caminata-ecologica-propuestas, sellable=false — le modifier casserait partner-propose-edit.spec.ts
// qui vérifie ses valeurs d'origine) ou à supabase/seed.sql (hors périmètre, cf. consignes).
const ESTABLISHMENT_ID = "b0000000-0000-4000-8000-000000000004";
const PARTNER_ID = "b0000000-0000-4000-8000-000000000003";

test("un admin consulte le diff d'une proposition, l'approuve avec un ajustement, et la fiche publique reflète la valeur corrigée", async ({
  page,
  context,
}) => {
  const suffix = Date.now();
  const originalName = `Actividad Moderación ${suffix}`;
  const slug = `moderate-test-${suffix}`;

  // Setup — produit dédié à ce test (admin, écriture directe RLS déjà couverte par products_
  // write_admin, Tranche 2 : pas de RPC de création de produit à ce stade du chantier), déjà
  // sellable=true pour pouvoir vérifier la fiche publique sans avoir à revenir dessus ensuite.
  // Client hors navigateur, authentifié par mot de passe — dogfooding, même esprit que les autres
  // e2e du projet (aucun insert SQL brut, de vrais appels RPC/REST).
  const adminClient = await createSignedInClient(SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  const { data: product, error: insertError } = await adminClient
    .from("products")
    .insert({
      partner_id: PARTNER_ID,
      establishment_id: ESTABLISHMENT_ID,
      type: "activity",
      name: { es: originalName },
      price_cop: 60000,
      category: "bienestar",
      sellable: true,
      slug,
    })
    .select("id")
    .single();
  if (insertError || !product) {
    throw new Error(`e2e setup: création du produit a échoué : ${insertError?.message}`);
  }

  // Proposition soumise par le socio propriétaire (feature 15, déjà gatée) — dogfooding plutôt
  // qu'un insert brut dans product_proposals (RPC-only).
  const proposedName = `Actividad Moderación (propuesta) ${suffix}`;
  const socioClient = await createSignedInClient(SEEDED_ACCOUNTS.operadorPropuestas, SEEDED_PASSWORD);
  const { data: submitResult, error: submitError } = await socioClient.rpc("submit_product_proposal", {
    p_product_id: product.id,
    p_payload: {
      name: { es: proposedName },
      description: { es: "Descripción propuesta por el socio" },
      price_cop: 65000,
      category: "adrenalina",
    },
  });
  if (submitError || !(submitResult as { ok: boolean } | null)?.ok) {
    throw new Error(`e2e setup: submit_product_proposal a échoué : ${submitError?.message}`);
  }
  const proposalId = (submitResult as { proposal_id: string }).proposal_id;

  // --- Admin : consulte le diff, corrige le prix différemment de ce qui était proposé, approuve ---
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto("/admin/proposals");

  await expect(page.getByTestId(`proposal-row-${proposalId}`)).toBeVisible();
  await page.getByTestId(`review-link-${proposalId}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/proposals/${proposalId}`));

  // Le formulaire de correction est pré-rempli avec les valeurs PROPOSÉES, pas les actuelles
  // (spec 15 bis, 2026-08-17 — ce formulaire réutilise désormais LocalizedTextField/
  // ProductTypeFields, comme ProductForm, plus l'ancien name-es/name-en séparé).
  await expect(page.locator('input[name="nombre"]')).toHaveValue(proposedName);
  await expect(page.getByTestId("price-input")).toHaveValue("65000");

  // Le bloc "Valor actual" (lecture seule) affiche bien la fiche encore publiée.
  await expect(page.getByTestId("current-values")).toContainText(originalName);

  // L'admin corrige le prix à une TROISIÈME valeur, différente de l'actuelle (60000) ET de la
  // proposée (65000) — preuve que la valeur qui prime est bien celle CORRIGÉE par l'admin.
  await page.getByTestId("price-input").fill("72000");
  await page.getByTestId("approve-button").click();

  // Le succès n'est plus un texte inline mais un toast (docs/specs/16-notifications-toast.md) —
  // HeroUI rend chaque toast avec role="alertdialog", le message passé à toast.success(...)
  // devient son titre visible.
  await expect(page.getByRole("alertdialog").filter({ hasText: "Propuesta aprobada." })).toBeVisible();

  // --- La fiche publique reflète la valeur CORRIGÉE (72000), ni l'actuelle (60000) ni la
  // proposée d'origine (65000) — et le nom proposé (non corrigé) est bien repris tel quel. ---
  await context.clearCookies();
  await page.goto(webProductUrl(slug));
  await expect(page.getByTestId("product-name")).toHaveText(proposedName);
  await expect(page.getByTestId("product-price")).toContainText(/72[.,]?000/);
});
