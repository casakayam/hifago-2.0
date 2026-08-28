// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getPmsFixtureCalls,
  resetPmsFixtureCalls,
  setPmsFixtureScenario,
  startPmsFixtureServer,
} from "@hifago/e2e-support";
import {
  addDaysIso,
  getNightAvailabilityRange,
  getNightAvailabilityWindow,
  nightsOfMonth,
  pickCategoryNights,
} from "@hifago/domain";

// LE TEST QUI COMPTE LES APPELS, contre le serveur de fixtures PARTAGÉ — celui que les tests e2e et
// le contrat admin utilisent déjà, pas un serveur inline écrit pour l'occasion. C'est délibéré :
// c'est CE serveur qui ignorait `end_date` jusqu'au 2026-08-28, et un test de réduction de charge
// écrit contre lui aurait été vert sans rien prouver. Les deux premiers cas ci-dessous vérifient
// donc d'abord que la fixture est HONNÊTE, avant que les suivants ne mesurent quoi que ce soit.
//
// Contexte chiffré (relevé du 2026-08-28) : LobbyPMS coupe à 60 appels par fenêtre glissante d'une
// minute (Retry-After décompté 55/54/53/52 en préprod — signature d'un `throttle:60,1` Laravel).
// Casa Kayam a SIX catégories cotées. Un mois affiché coûtait donc jusqu'à 180 appels : trois fois
// le plafond, pour un seul établissement et un seul visiteur.
const PORT = 34567;
const GUSTO = 36572;
const ALL_CATEGORIES = [9629, 9631, 18013, 29376, GUSTO, 49823];
const AVAILABLE_ROOMS_PATH = "/api/v2/available-rooms";

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  baseUrl = server.url;
  close = server.close;
});

afterAll(async () => {
  await close();
});

beforeEach(() => {
  resetPmsFixtureCalls();
  setPmsFixtureScenario({ catalogCategoryIds: ALL_CATEGORIES });
});

describe("le serveur de fixtures honore end_date (sans quoi tout ce qui suit serait faussement vert)", () => {
  it("`end_date` est INCLUSIF : D→D+1 rend DEUX nuits, comme le vrai LobbyPMS", async () => {
    // Mesuré le 2026-08-28 sur le compte réel : demandé 2026-09-27 → 2026-10-02, SIX
    // enregistrements. La fixture reproduit donc l'inclusivité, et non l'hypothèse exclusive que la
    // production portait depuis le premier jour sans l'avoir vérifiée.
    const response = await fetch(
      `${baseUrl}${AVAILABLE_ROOMS_PATH}?api_token=fake&start_date=2028-11-01&end_date=2028-11-02`
    );
    const body = (await response.json()) as { data: { date: string }[]; meta: { records_per_page: number } };
    expect(body.data.map((record) => record.date)).toEqual(["2028-11-01", "2028-11-02"]);
    // 100 par page : c'est ce chiffre qui autorise un appel unique par mois sans jamais paginer.
    expect(body.meta.records_per_page).toBe(100);
  });

  it("une demande D→D+30 rend TRENTE ET UN enregistrements datés, pas un seul répété", async () => {
    // ⚠️ C'EST LE TÉMOIN DE LA FIXTURE ELLE-MÊME, et il a été EXÉCUTÉ contre l'ancienne version :
    // avant le 2026-08-28 ce serveur répondait `{"date":"2028-11-01","categories":[]}` à cette
    // requête exacte — UNE nuit, sans `data[]`, quelle que soit `end_date`. Un test « un seul appel
    // pour 30 nuits » écrit contre cette fixture-là aurait été vert sans rien prouver.
    // 31 et non 30 : `end_date` est inclusif (mesuré), donc le 1er décembre est rendu lui aussi.
    const response = await fetch(
      `${baseUrl}${AVAILABLE_ROOMS_PATH}?api_token=fake&start_date=2028-11-01&end_date=2028-12-01`
    );
    const body = (await response.json()) as { data: { date: string }[] };
    expect(body.data).toHaveLength(31);
    expect(body.data[0].date).toBe("2028-11-01");
    expect(body.data.at(-1)?.date).toBe("2028-12-01");
    expect(new Set(body.data.map((record) => record.date)).size).toBe(31);
  });
});

describe("R1 — six produits d'un établissement, une seule lecture par nuit", () => {
  it("30 appels pour le mois entier, quel que soit le nombre de produits liés", async () => {
    const nights = nightsOfMonth("2028-11");
    const window = await getNightAvailabilityWindow(baseUrl, "fake-token", nights);

    expect(window.ok).toBe(true);
    if (!window.ok) return;
    expect(getPmsFixtureCalls(AVAILABLE_ROOMS_PATH)).toBe(30);

    // Les SIX produits sont servis par cette unique lecture — c'est le sens du changement : ce qui
    // est lu appartient à l'établissement, plus au produit.
    for (const categoryId of ALL_CATEGORIES) {
      const picked = pickCategoryNights(window.nights, categoryId);
      expect(picked.missingDates).toEqual([]);
      expect(picked.nights).toHaveLength(30);
    }
  });

  it("MESURE DE RÉFÉRENCE — le même mois, un appel par (nuit, catégorie) : 180 appels", async () => {
    // ⚠️ Ce n'est PAS un témoin, et l'appeler ainsi serait malhonnête : ce bloc n'exerce aucun code
    // de production, il émet 180 requêtes à la main et vérifie que le compteur en voit 180. Il ne
    // peut donc rougir pour aucune raison liée au code. Sa valeur est ailleurs : il établit le
    // dénominateur SUR LE MÊME SERVEUR, plutôt que de citer un chiffre extrapolé dans un
    // commentaire. Les vrais témoins de ce lot sont ceux qui rejouent un code ou un Lobby fautif
    // et le prennent en défaut.
    const nights = nightsOfMonth("2028-11");
    for (const categoryId of ALL_CATEGORIES) {
      for (const night of nights) {
        await fetch(
          `${baseUrl}${AVAILABLE_ROOMS_PATH}?api_token=fake&category_id=${categoryId}&start_date=${night}&end_date=${night}`
        );
      }
    }
    expect(getPmsFixtureCalls(AVAILABLE_ROOMS_PATH)).toBe(180);
  });
});

describe("la pagination, que personne n'avait exercée", () => {
  it("au-delà de 100 nuits, Lobby tronque — et la fenêtre ÉCHOUE au lieu de rendre un mois amputé", async () => {
    // `records_per_page` vaut 100 (observé). Une fenêtre plus large qu'une page serait tronquée par
    // Lobby, et le seul rempart est la vérification de COUVERTURE : `meta.total_pages` n'est lu par
    // personne sur le chemin de réservation, délibérément — on ne pagine pas pour réserver.
    // ⚠️ Ce test n'était pas écrivable avant le 2026-08-28 : la fixture rendait 151 enregistrements
    // en annonçant une page de 100, donc plus complaisante que le vrai service.
    const nights = Array.from({ length: 150 }, (_, index) => addDaysIso("2028-11-01", index));

    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unparseable");
    expect("bodyExcerpt" in result.failure && result.failure.bodyExcerpt).toContain("incomplete_coverage");
    // Un seul appel : on n'a pas non plus dépensé du quota à paginer une fenêtre qu'on refuse.
    expect(getPmsFixtureCalls(AVAILABLE_ROOMS_PATH)).toBe(1);
  });

  it("un mois tient dans une page — c'est ce qui rend l'appel unique légitime", async () => {
    const response = await fetch(
      `${baseUrl}${AVAILABLE_ROOMS_PATH}?api_token=fake&start_date=2028-10-01&end_date=2028-11-01`
    );
    const body = (await response.json()) as { data: unknown[]; meta: { total_pages: number } };
    expect(body.data).toHaveLength(32); // 31 nuits demandées + la borne inclusive
    expect(body.meta.total_pages).toBe(1);
  });
});

describe("R1 + plage — ce que coûte vraiment un mois affiché, aujourd'hui", () => {
  it("UN appel pour 30 nuits ET six produits, contre 180 avant le 2026-08-28", async () => {
    // LE CHIFFRE DU DOSSIER. Le plafond mesuré est de 60 appels par fenêtre glissante d'une minute.
    // Avant : 180 appels pour un mois chez Casa Kayam — trois fois le plafond, pour un seul
    // établissement et un seul visiteur, ce qui produisait des mois PARTIELS impossibles à
    // diagnostiquer. Après : 1.
    const nights = nightsOfMonth("2028-11");
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getPmsFixtureCalls(AVAILABLE_ROOMS_PATH)).toBe(1);
    expect(result.nights).toHaveLength(30);
    for (const categoryId of ALL_CATEGORIES) {
      const picked = pickCategoryNights(result.nights, categoryId);
      expect(picked.missingDates).toEqual([]);
      expect(picked.nights).toHaveLength(30);
    }
  });
});

describe("la plage, dans les mondes que la sonde a réfutés", () => {
  it("31 nuits en UN appel, chaque ligne datée par la réponse", async () => {
    const nights = nightsOfMonth("2028-10");
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getPmsFixtureCalls(AVAILABLE_ROOMS_PATH)).toBe(1);
    expect(result.nights.map((row) => row.date)).toEqual(nights);
    expect(pickCategoryNights(result.nights, GUSTO).missingDates).toEqual([]);
  });

  it("⚠️ contre un Lobby qui ignore end_date, la plage échoue — jamais un mois faux et plausible", async () => {
    setPmsFixtureScenario({ catalogCategoryIds: ALL_CATEGORIES, rangeBehaviour: "ignores_end_date" });
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nightsOfMonth("2028-10"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unparseable");
  });

  it("⚠️ même contre un end_date EXCLUSIF, la plage reste exacte — aucun rang n'étiquette rien", async () => {
    setPmsFixtureScenario({ catalogCategoryIds: ALL_CATEGORIES, endDateInclusive: false });
    const nights = nightsOfMonth("2028-10");
    const result = await getNightAvailabilityRange(baseUrl, "fake-token", nights);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nights.map((row) => row.date)).toEqual(nights);
  });
});
