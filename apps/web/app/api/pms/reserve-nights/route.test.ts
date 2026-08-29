// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setPmsFixtureScenario, startPmsFixtureServer } from "@hifago/e2e-support";

// LE VERDICT DE CETTE ROUTE EST DÉSORMAIS CE QUI DÉCIDE SI LE CLIENT EST DÉBITÉ. Avant le
// 2026-08-29 elle était appelée en `void` et répondait toujours `{ok:true}` : rien à tester, rien à
// casser. Maintenant qu'elle est attendue AVANT confirmation et AVANT encaissement, chacune de ses
// branches vaut de l'argent — d'où ce fichier, et d'où le fait que les invariants y soient vérifiés
// par MUTATION (cf. journal), pas seulement par des tests verts.
//
// Seule la base est simulée. LobbyPMS est un VRAI serveur HTTP (packages/e2e-support), parce que
// c'est exactement là que vit le cas qui a motivé le lot : un 422 sur `POST /bookings`.
const PORT = 34573;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LODGING_LINE = "22222222-2222-4222-8222-222222222222";
const ACTIVITY_LINE = "33333333-3333-4333-8333-333333333333";

interface Ligne {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  holder_name: string;
  holder_email: string | null;
  holder_phone: string | null;
  price_cop: number;
  total_cop: number;
}

let lignes: Ligne[] = [];
let produits: Record<string, unknown>[] = [];
let etablissements: Record<string, unknown>[] = [];
const reconciliations: Record<string, unknown>[] = [];
const rpcAppels: { nom: string; args: Record<string, unknown> }[] = [];
let releaseOk = true;

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain,
        eq: chain,
        in: chain,
        is: chain,
        not: chain,
        update: () => ({ eq: async () => ({ data: null }) }),
        insert: async (row: Record<string, unknown>) => {
          if (table === "pms_reconciliation_entries") reconciliations.push(row);
          return { data: null };
        },
        maybeSingle: async () => ({ data: table === "orders" ? { attribution_code: null, attribution_source: null } : null }),
        returns: () => builder,
        then: (resolve: (value: { data: unknown }) => unknown) => {
          if (table === "order_lines") return Promise.resolve({ data: lignes }).then(resolve);
          if (table === "products") return Promise.resolve({ data: produits }).then(resolve);
          if (table === "establishments") return Promise.resolve({ data: etablissements }).then(resolve);
          return Promise.resolve({ data: null }).then(resolve);
        },
      });
      return builder;
    },
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return releaseOk
        ? { data: { ok: true, released_lines: lignes.length }, error: null }
        : { data: null, error: { message: "verrou indisponible" } };
    },
  }),
}));

let close: () => Promise<void>;
let POST: (request: Request) => Promise<Response>;

const appeler = () =>
  POST(
    new Request("http://localhost/api/pms/reserve-nights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: ORDER_ID }),
    })
  );

const ligneLogement = (): Ligne => ({
  id: LODGING_LINE,
  product_id: "prod-lodging",
  date: "2028-09-01",
  end_date: "2028-09-03",
  qty: 2,
  holder_name: "Holder",
  holder_email: "h@test.local",
  holder_phone: null,
  price_cop: 200000,
  total_cop: 200000,
});

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  process.env.LOBBY_API_BASE_URL = server.url;
  close = server.close;
  ({ POST } = await import("./route"));
});

afterAll(async () => {
  delete process.env.LOBBY_API_BASE_URL;
  await close();
});

beforeEach(() => {
  setPmsFixtureScenario({});
  releaseOk = true;
  rpcAppels.length = 0;
  reconciliations.length = 0;
  lignes = [ligneLogement()];
  produits = [
    { id: "prod-lodging", type: "lodging", lobby_category_id: 36572, lobby_product_id: null, establishment_id: "etab" },
  ];
  etablissements = [{ id: "etab", lobby_connector_active: true, lobby_api_token: "fake" }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Lobby accepte", () => {
  it("répond ok:true et ne relâche RIEN", async () => {
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcAppels).toEqual([]);
    expect(reconciliations).toEqual([]);
  });

  it("une commande SANS ligne PMS-backed ne touche jamais Lobby — le chemin non-PMS est intact", async () => {
    produits = [
      { id: "prod-lodging", type: "lodging", lobby_category_id: null, lobby_product_id: null, establishment_id: "etab" },
    ];
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcAppels).toEqual([]);
  });
});

describe("Lobby refuse une NUIT — le cas du 422", () => {
  beforeEach(() => {
    // Le refus réellement observé : `POST /bookings` répond 422 alors qu'`available-rooms` cotait
    // la catégorie comme disponible (spec 24 §11.2, C1 réfuté).
    setPmsFixtureScenario({ createBookingStatus: 422, createBookingBody: { error_code: "INPUT_PARAMETERS" } });
  });

  it("relâche la commande et répond 409 — donc rien n'est encaissé", async () => {
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_refused", released: true });

    expect(rpcAppels).toHaveLength(1);
    expect(rpcAppels[0].nom).toBe("release_order_after_pms_refusal");
    expect(rpcAppels[0].args.p_order_id).toBe(ORDER_ID);
  });

  it("n'écrit AUCUNE entrée de réconciliation : l'incident est défait, pas à traiter", async () => {
    // pms_reconciliation_entries déclenche notify_all_admins SANS dédup : une entrée par refus
    // enverrait un e-mail « à traiter » à chaque admin pour quelque chose que personne ne peut ni
    // ne doit traiter. Le même piège avait déjà produit une salve d'e-mails le 2026-08-26.
    await appeler();
    expect(reconciliations).toEqual([]);
  });

  it("⚠️ si le relâchement ÉCHOUE, l'entrée de réconciliation redevient la bonne réponse", async () => {
    // C'est le seul cas qui laisse une commande pendante : Lobby a refusé ET on n'a pas su défaire.
    // Là, un humain est réellement nécessaire.
    releaseOk = false;
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_refused", released: false });
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: LODGING_LINE });
    expect(String(reconciliations[0].detail)).toContain("relâchement impossible");
  });
});

describe("une ACTIVITÉ refusée ne relâche jamais la commande", () => {
  it("la nuit est réservée chez le partenaire : on garde la commande et on réconcilie l'extra", async () => {
    // ⚠️ L'asymétrie est délibérée. Annuler une nuit bien réservée parce qu'un extra a échoué
    // serait pire que le défaut qu'on corrige : le client perdrait son logement pour une activité.
    lignes = [
      ligneLogement(),
      {
        id: ACTIVITY_LINE,
        product_id: "prod-activity",
        date: "2028-09-01",
        end_date: null,
        qty: 3,
        holder_name: "Holder",
        holder_email: "h@test.local",
        holder_phone: null,
        price_cop: 50000,
        total_cop: 150000,
      },
    ];
    produits = [
      { id: "prod-lodging", type: "lodging", lobby_category_id: 36572, lobby_product_id: null, establishment_id: "etab" },
      { id: "prod-activity", type: "activity", lobby_category_id: null, lobby_product_id: 494426, establishment_id: "etab" },
    ];
    setPmsFixtureScenario({ addProductServiceStatus: 422, addProductServiceBody: { error_code: "INPUT_PARAMETERS" } });

    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcAppels).toEqual([]);
    // …et l'échec de l'activité part bien en réconciliation, comme avant ce lot.
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: ACTIVITY_LINE });
  });
});
