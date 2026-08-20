import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { withDb, toggleCheckbox } from "@hifago/e2e-support";
import { loginAs, SEEDED_ACCOUNTS, SEEDED_PASSWORD } from "./support/login";

// Spec 21 — connecteur LobbyPMS, bloc admin de la fiche établissement. Établissement DÉDIÉ créé
// dans ce test (jamais "Casa Kayam Guatapé" du seed, partagé par d'autres specs — cf.
// AGENTS-PARALLELES.md point 5, ne jamais muter un enregistrement seedé partagé). Ne teste PAS le
// bouton "Probar conexión" (appellerait le vrai LobbyPMS faute de LOBBY_API_BASE_URL configuré en
// e2e — hors périmètre : aucun test automatisé de ce projet ne doit jamais toucher le vrai
// LobbyPMS, spec 21 §10 point 1) — seulement le parcours CRUD de sauvegarde, chemin heureux unique
// (hifago/CLAUDE.md §6.5, proportionnalité).
const TIMESTAMP = Date.now();
const ESTABLISHMENT_ID = randomUUID();

test("un admin active le conector PMS d'un établissement, sauvegarde un token et le voit persister", async ({
  page,
}) => {
  const partnerId = await withDb(async (client) => {
    const { rows } = await client.query(
      "select partner_id from establishments where id = $1",
      ["b0000000-0000-4000-8000-000000000002"],
    );
    return rows[0].partner_id as string;
  });

  await withDb((client) =>
    client.query(
      `insert into establishments (id, partner_id, name) values ($1, $2, $3)`,
      [ESTABLISHMENT_ID, partnerId, JSON.stringify({ es: `E2E PMS Connector ${TIMESTAMP}` })],
    ),
  );

  await loginAs(page.context(), SEEDED_ACCOUNTS.admin, SEEDED_PASSWORD);
  await page.goto(`/admin/establishments/${ESTABLISHMENT_ID}`);
  await page.waitForLoadState("networkidle");

  const pmsBlock = page.getByTestId("establishment-pms-block");
  await expect(pmsBlock).toBeVisible();
  await expect(page.getByTestId("pms-has-token-status")).toContainText("no");

  await page.getByTestId("pms-token-input").fill("e2e-fake-lobby-token");
  await toggleCheckbox(page.getByTestId("pms-connector-active-checkbox"));
  await page.getByTestId("pms-reason-input").fill("Activación E2E del conector PMS");
  await page.getByTestId("save-pms-connector-button").click();

  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Conector PMS actualizado." }),
  ).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("pms-has-token-status")).toContainText("sí");
  await expect(page.getByTestId("pms-connector-active-checkbox").locator("input")).toBeChecked();

  const persisted = await withDb(async (client) => {
    const { rows } = await client.query(
      "select lobby_connector_active, lobby_api_token from establishments where id = $1",
      [ESTABLISHMENT_ID],
    );
    return rows[0] as { lobby_connector_active: boolean; lobby_api_token: string };
  });
  expect(persisted.lobby_connector_active).toBe(true);
  expect(persisted.lobby_api_token).toBe("e2e-fake-lobby-token");

  await withDb((client) => client.query("delete from establishments where id = $1", [ESTABLISHMENT_ID]));
});
