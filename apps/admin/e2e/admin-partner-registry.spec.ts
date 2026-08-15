import { test, expect } from "@playwright/test";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";
import { selectValue, switchInput, toggleSwitch } from "@hifago/e2e-support";

test("admin gère le registre d'un partenaire : capacité, statut, transfert, code", async ({
  page,
  context,
}) => {
  await loginAs(context, SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);

  // Établissement dédié à ce test — nom unique par run, jamais un établissement déjà partagé par
  // d'autres tests e2e. Rattaché à "Opérateur Actif Org" au départ (peu importe qui), transféré
  // plus bas.
  const establishmentName = `Establecimiento Transfer Test ${Date.now()}`;
  await page.goto("/admin/establishments/new");
  await page.locator('input[name="nombre"]').fill(establishmentName);
  await page.getByTestId("partner-search").click();
  await page.getByRole("option", { name: /Opérateur Actif/ }).click();
  await page.getByTestId("create-establishment-button").click();
  await expect(page).toHaveURL(/\/admin\/establishments$/);

  // Ouvre la fiche de "Référent Actif Org" — capacité referrer seule au départ (seedée).
  await page.goto("/admin/partners");
  const partnerRow = page.locator("tr", { hasText: "Référent Actif Org" });
  await partnerRow.getByRole("link", { name: "Ver" }).click();
  await expect(page).toHaveURL(/\/admin\/partners\/.+/);

  // Transférer l'établissement fraîchement créé vers ce partenaire AVANT d'accorder la capacité
  // operator — nécessaire pour qu'il apparaisse dans le sélecteur "Otorgar capacidad" ci-dessous,
  // et surtout pour que la capacité operator accordée juste après soit scopée à CET établissement
  // précis (unique par run) plutôt qu'"en attente" (establishment_id null) : sans ça, relancer ce
  // test sans `db reset` entre deux runs entrerait en collision avec l'unique ligne operator "en
  // attente" déjà créée par un run précédent (index partiel dédié, cf. correctif Tranche 1).
  await page.getByTestId("transfer-establishment-search").click();
  await page.getByRole("option", { name: new RegExp(establishmentName) }).click();
  await page.getByTestId("transfer-establishment-button").click();
  await expect(
    page.getByTestId("own-establishments-table").getByText(establishmentName)
  ).toBeVisible();

  // Accorder la capacité operator, scopée à cet établissement — la ligne referrer (déjà
  // existante) reste visible à côté.
  const capabilitiesTable = page.getByTestId("capabilities-table");
  await page.getByTestId("grant-role-select").click();
  await page.getByRole("option", { name: "operator" }).click();
  await page.getByTestId("grant-establishment-select").click();
  await page.getByRole("option", { name: establishmentName }).click();
  await page.getByTestId("grant-capability-button").click();
  // Scopé à la ligne de CET établissement (nom unique par run) plutôt qu'un texte "operator"
  // générique : après plusieurs runs sans reset, plusieurs lignes operator coexistent
  // légitimement (une par établissement, cf. commentaire ci-dessus) et rendraient l'assertion
  // ambiguë.
  const operatorRow = capabilitiesTable.locator("tr", { hasText: establishmentName });
  await expect(operatorRow).toBeVisible();
  await expect(operatorRow).toContainText("operator");
  await expect(capabilitiesTable.getByText("referrer")).toBeVisible();
  // Trigger HeroUI Select : role="button" + aria-haspopup="listbox" (pattern React Aria), pas
  // role="combobox" (pattern de l'ancien socle base-ui/shadcn) — vérifié sur le DOM réel. Ciblé
  // par le testid déjà posé par CapabilitiesSection.tsx (scopé à la ligne, id inconnu ici), pas
  // par rôle+libellé traduit — les deux casseraient au moindre changement de wording/rôle.
  await operatorRow.getByTestId(/^capability-status-select-/).click();
  await page.getByRole("option", { name: "suspended" }).click();
  await expect(selectValue(operatorRow)).toContainText("suspended");

  // Désactiver ou réactiver un code d'attribution du partenaire — bascule vers l'état opposé au
  // départ, jamais une valeur fixe attendue (la base locale n'est pas remise à zéro entre deux
  // exécutions e2e, cf. la même précaution déjà prise pour le prix en feature 3).
  const codeSwitch = switchInput(page.getByTestId("code-active-switch-SEED-REFACTIVE"));
  const wasChecked = await codeSwitch.isChecked();
  await toggleSwitch(page.getByTestId("code-active-switch-SEED-REFACTIVE"));
  // isSelected est piloté par le prop serveur (code.active), pas d'état local optimiste — le
  // changement visible attend le aller-retour RPC + router.refresh(), plus lent qu'un simple
  // clic client ; délai plus généreux que le défaut pour ne pas confondre lenteur et régression.
  if (wasChecked) {
    await expect(codeSwitch).not.toBeChecked({ timeout: 10000 });
  } else {
    await expect(codeSwitch).toBeChecked({ timeout: 10000 });
  }
});
