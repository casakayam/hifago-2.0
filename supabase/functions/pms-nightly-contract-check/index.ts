// Spec 21 — Connecteur LobbyPMS, Phase 6. Job nocturne SÉPARÉ, non bloquant, LECTURE SEULE
// uniquement (jamais un POST/PUT/DELETE) — détecte une dérive de la forme des réponses LobbyPMS
// par rapport à ce que le connecteur suppose (docs/3-integrations/lobby_pms_api.md, racine du
// dépôt), avant que ça ne casse silencieusement une vraie réservation.
//
// Correction factuelle par rapport à l'architecture cible initiale (hifago/docs/04-architecture-
// cible.md § Tests et CI/CD, qui évoquait « le vrai sandbox LobbyPMS ») : AUCUN sandbox LobbyPMS
// n'existe (confirmé, spec 21 §10 point 1) — ce job frappe donc le(s) compte(s) réel(s) des
// établissements dont le connecteur est actif (Casa Kayam aujourd'hui, seul cas réel), jamais un
// environnement de test dédié. Décision explicite de Jérôme (spec 21) : lecture seule stricte,
// jamais en CI/en test (aucun test automatisé de ce fichier ne doit jamais l'invoquer contre le
// vrai baseUrl — seulement contre un serveur de fixtures via LOBBY_API_BASE_URL).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getLobbyAvailableRooms,
  getLobbyRooms,
  LOBBY_DEFAULT_BASE_URL,
} from "../../../packages/domain/src/pms/lobbyClient.ts";
import { parseLobbyRooms } from "../../../packages/domain/src/pms/parseLobbyRooms.ts";
import { parseLobbyAvailabilityContract } from "../../../packages/domain/src/pms/parseLobbyAvailabilityContract.ts";

interface EstablishmentRow {
  id: string;
  lobby_api_token: string | null;
}

// Un 403 de Caddy (relais : en-tête X-Relay-Secret refusé, corps « forbidden ») et un 403 de
// LobbyPMS (IP non whitelistée, corps JSON) sont INDISCERNABLES quand on ne rapporte que le statut.
// Le 2026-08-27 ça a coûté plusieurs allers-retours de diagnostic à l'aveugle. Le corps tranche en
// un coup d'œil, et il ne coûte rien : il est déjà lu et parsé par lobbyCall.
//
// SÛRETÉ : on n'imprime QUE le corps de la RÉPONSE. Jamais l'URL de la requête — elle porte
// `api_token` en query string (hifago/CLAUDE.md §8). Tronqué court : un corps d'erreur utile tient
// en deux lignes, et une page HTML d'erreur d'un proxy amont n'a pas à noyer les logs.
function describeErrorBody(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (!text) return "corps vide";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function hasExpectedRoomsShape(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data);
}

// Étendu le 2026-08-26. Vérifier que `data` est un tableau ne suffit plus : depuis que l'écran de
// liaison affiche et prérremplit le contenu Lobby (type/capacity/descriptions[]/photos[]), la
// disparition SILENCIEUSE d'un de ces champs ne casserait rien — les parseurs sont défensifs, ils
// omettent proprement — mais viderait l'écran sans que personne ne le sache. C'est exactement le
// genre de dérive que ce job existe pour attraper. Les formes ONT depuis été observées en
// conditions réelles (2026-08-26, compte Casa Kayam — spec 24 §11.1 : 6/6 catégories portent
// type/capacity/quantity, 4/6 portent descriptions[]/photos[]) : ce job ne surveille donc plus une
// hypothèse tirée de la doc, mais un contrat constaté. Raison de plus pour qu'il tourne — sa
// vigilance porte désormais sur une régression réelle, pas sur une supposition.
//
// Aucune de ces absences n'est une panne : ce sont des signalements. Un compte peut légitimement
// n'avoir aucune photo. Le but est de distinguer « Lobby ne renvoie plus ce champ » de « le champ
// est vide chez ce client », en le disant plutôt qu'en l'ignorant.
function describeRoomsFieldCoverage(body: unknown): string[] {
  const categories = parseLobbyRooms(body);
  if (categories.length === 0) return ["aucune catégorie exploitable dans GET /rooms"];

  const notes: string[] = [];
  // Compte `rawType`, pas `kind` : c'est la PRÉSENCE du champ Lobby qu'on surveille, pas notre
  // capacité à le normaliser. Renommé le 2026-08-26 — il s'appelait withKind et mesurait rawType.
  const withRawType = categories.filter((c) => c.rawType !== null).length;
  const withCapacity = categories.filter((c) => c.capacity !== null).length;
  const withDescription = categories.filter((c) => Object.keys(c.descriptions).length > 0).length;
  const withPhotos = categories.filter((c) => c.photos.length > 0).length;

  if (withRawType === 0) notes.push("aucune catégorie ne porte `type`");
  if (withCapacity === 0) notes.push("aucune catégorie ne porte `capacity`");
  if (withDescription === 0) notes.push("aucune catégorie ne porte `descriptions[]`");
  if (withPhotos === 0) notes.push("aucune catégorie ne porte `photos[]`");

  // Une langue que l'éditeur hifago ne sait pas afficher (fermé à es/en) : la signaler, sinon la
  // description existe chez Lobby et n'arrive jamais nulle part sans explication.
  const unsupported = [...new Set(categories.flatMap((c) => c.unsupportedLangs))].sort();
  if (unsupported.length > 0) notes.push(`descriptions dans des langues non éditables : ${unsupported.join(", ")}`);

  return notes;
}

// Sonde de contrat sur GET /api/v2/available-rooms (2026-08-27). Ce job était déjà le bon endroit :
// il tourne en préprod, il tient le jeton par la BASE (jamais par une variable d'environnement, et
// jamais dans un poste de dev), et sa raison d'être est de dire ce que Lobby renvoie. Deux points
// du plan attendaient une observation que personne ne pouvait faire depuis un poste de dev :
//
//   C1 — quel attribut sépare une catégorie réservable par API d'une qui refuse en 422 ? Si Lobby
//        n'énumère ici QUE les réservables, la réponse EST le filtre, et on n'a jamais à coder un
//        identifiant en dur. Sinon, les signatures de champs ci-dessous sont le seul autre angle.
//   C5 — les valeurs réelles de restrictions{min_stay, max_stay, lead_days}, jamais observées.
//
// Les rendre visibles ICI plutôt que par une sonde jetable a un effet durable : la réponse arrive
// sans intervention humaine, et reste SURVEILLÉE ensuite. Une sonde manuelle aurait répondu une
// fois puis serait devenue une capture périmée dans un document.
//
// Ces lignes vont dans `observations`, JAMAIS dans `drifts` : une dérive dit « quelque chose a
// cassé », une observation dit « voici la tête du contrat aujourd'hui ». Les confondre ferait crier
// au loup ce job à chaque nuit, et la prochaine vraie dérive passerait inaperçue.
function describeAvailabilityContract(body: unknown, knownCategoryIds: number[]): string[] {
  const contract = parseLobbyAvailabilityContract(body);
  if (!contract.ok) return ["GET /available-rooms : corps inexploitable (aucun `categories[]`)"];

  const notes: string[] = [];
  const listed = new Set(contract.categoryIds);
  const absent = knownCategoryIds.filter((id) => !listed.has(id));
  const extra = contract.categoryIds.filter((id) => !knownCategoryIds.includes(id));

  notes.push(
    `available-rooms cote ${contract.categoryIds.length}/${knownCategoryIds.length} catégories : ${contract.categoryIds.join(", ")}`
  );
  // Disponibilité par catégorie : dernier angle pour C1. Une catégorie que Lobby cote mais qui
  // n'a JAMAIS de disponibilité serait un discriminant plausible — à distinguer d'un simple
  // « complet cette nuit-là », ce que seule une observation répétée peut faire. D'où sa place ici,
  // dans un job qui repasse chaque nuit, plutôt que dans une sonde unique.
  notes.push(
    `available_rooms : ${contract.categories.map((c) => `${c.categoryId}=${c.availableRooms}`).join(", ")}`
  );
  if (absent.length > 0) {
    notes.push(`absentes d'available-rooms (candidat C1 — non réservables par API ?) : ${absent.join(", ")}`);
  }
  if (extra.length > 0) {
    notes.push(`cotées ici mais absentes de GET /rooms : ${extra.join(", ")}`);
  }

  notes.push(
    `plans/prix : ${contract.categories.map((c) => `${c.categoryId}=${c.planCount}p/${c.priceCount}€`).join(", ")}`
  );

  const withRestrictions = contract.categories.filter((c) => c.restrictions !== null);
  if (withRestrictions.length === 0) {
    notes.push("aucune catégorie ne porte `restrictions` — C5 reste sans valeur observée");
  } else {
    for (const category of withRestrictions) {
      notes.push(`restrictions[${category.categoryId}] = ${JSON.stringify(category.restrictions)}`);
    }
  }

  // Deux familles de catégories, si elles existent, se voient comme deux signatures distinctes.
  const signatures = new Map<string, number[]>();
  for (const category of contract.categories) {
    const key = category.keys.join(",");
    signatures.set(key, [...(signatures.get(key) ?? []), category.categoryId]);
  }
  for (const [keys, ids] of signatures) {
    notes.push(`signature [${keys}] → catégories ${ids.join(", ")}`);
  }

  return notes;
}

// Nuit sondée : J+30. Assez loin pour qu'un `lead_days` ne puisse pas masquer une catégorie (ce
// serait confondre « non réservable » avec « pas encore ouvert », exactement l'erreur que C1 doit
// éviter), assez proche pour rester dans l'horizon de réservation de n'importe quel plan tarifaire.
function probeNights(): { date: string; nextDate: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { date: iso(start), nextDate: iso(next) };
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: establishments, error } = await supabase
    .from("establishments")
    .select("id, lobby_api_token")
    .eq("lobby_connector_active", true)
    .returns<EstablishmentRow[]>();

  if (error) {
    console.error("pms-nightly-contract-check : lecture establishments a échoué", error);
    return new Response(JSON.stringify({ ok: false, reason: "read_failed" }), { status: 500 });
  }

  const drifts: string[] = [];
  const observations: string[] = [];
  const { date, nextDate } = probeNights();
  for (const establishment of establishments ?? []) {
    if (!establishment.lobby_api_token) continue;
    let knownCategoryIds: number[] = [];
    try {
      const rooms = await getLobbyRooms(baseUrl, establishment.lobby_api_token, undefined, relaySecret);
      if (rooms.status !== 200 || !hasExpectedRoomsShape(rooms.body)) {
        drifts.push(
          `établissement ${establishment.id} : GET /rooms forme inattendue (status ${rooms.status}) — ${describeErrorBody(rooms.body)}`
        );
      } else {
        knownCategoryIds = parseLobbyRooms(rooms.body).map((category) => category.categoryId);
        for (const note of describeRoomsFieldCoverage(rooms.body)) {
          drifts.push(`établissement ${establishment.id} : ${note}`);
        }
      }
    } catch (err) {
      drifts.push(`établissement ${establishment.id} : GET /rooms injoignable (${err})`);
    }

    // UNE requête par établissement, pas une par catégorie : sans `category_id`, Lobby renvoie tout
    // le catalogue pour la nuit. Coût total du job : +1 appel par nuit et par établissement connecté.
    // Sautée si GET /rooms n'a rien donné — sans la liste de référence, « absente d'available-rooms »
    // ne voudrait rien dire.
    if (knownCategoryIds.length === 0) continue;
    try {
      const availability = await getLobbyAvailableRooms(
        baseUrl, establishment.lobby_api_token, date, nextDate, relaySecret
      );
      if (availability.status !== 200) {
        observations.push(
          `établissement ${establishment.id} : GET /available-rooms (nuit ${date}) a répondu ${availability.status} — ${describeErrorBody(availability.body)}`
        );
      } else {
        for (const note of describeAvailabilityContract(availability.body, knownCategoryIds)) {
          observations.push(`établissement ${establishment.id} : ${note}`);
        }
      }
    } catch (err) {
      observations.push(`établissement ${establishment.id} : GET /available-rooms injoignable (${err})`);
    }
  }

  // Jamais bloquant (non-CI, non-test) — une alerte console est le seul effet de bord voulu ici,
  // à brancher sur une vraie supervision (ex. log drain → alerte) hors périmètre code de cette spec.
  if (drifts.length > 0) {
    console.warn("pms-nightly-contract-check : dérive de contrat détectée", drifts);
  }
  // Journalisé en `info` et non en `warn` : ce n'est pas une alerte, c'est le relevé de la nuit.
  // Il laisse une trace dans les logs de la fonction même quand personne ne lit la réponse HTTP —
  // ce qui est le cas nominal, le job étant déclenché par pg_cron.
  if (observations.length > 0) {
    console.info("pms-nightly-contract-check : contrat observé", observations);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: (establishments ?? []).length, drifts, observations }),
    { headers: { "Content-Type": "application/json" } }
  );
});
