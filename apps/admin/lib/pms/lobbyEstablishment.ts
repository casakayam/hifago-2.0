import { LOBBY_DEFAULT_BASE_URL, parseLobbyPageMeta, type LobbyCallResult } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Frontière d'accès aux données LobbyPMS d'un établissement, définie UNE fois (/simplify du
// 2026-08-26). Les trois Route Handlers `api/pms/*` en portaient chacun leur copie : 38 lignes
// strictement identiques entre lobby-rooms et lobby-services, 18 de plus dans import-room-photos.
// Le commentaire de ce dernier consacrait même cinq lignes à ARGUMENTER que sa garde était bien la
// même que celle des deux autres — un helper rend cet argument vérifiable au lieu de déclaratif.
//
// ⚠️ Ce n'était pas qu'une duplication : la garde recopiée était plus FAIBLE que celle de la base.
// Elle comparait `establishment.partner_id` au partenaire du compte, alors que la RPC qui persiste
// réellement le travail (`submit_product_creation_proposal`) exige
// `has_capability(uid, 'operator', establishment_id)` — laquelle filtre en plus sur
// `status = 'active'` et sur l'établissement précis. Un compte dont la capacité operator est
// SUSPENDUE, ou un compte référent-seul du même partenaire, franchissait donc la route, déclenchait
// des appels sur le jeton Lobby du partenaire et jusqu'à 6 écritures dans catalog-media — pour une
// proposition que la RPC refusait ensuite en `capability_suspended`. Le travail sortant et les
// octets écrits, eux, étaient déjà consommés. Corrigé ici, donc pour les trois routes à la fois.
export type LobbyEstablishmentAccess =
  | {
      ok: true;
      establishmentId: string;
      apiToken: string;
      baseUrl: string;
      relaySecret: string | undefined;
      /** Client porteur de la session de l'appelant — pour les RPC qui doivent rester gardées (add_catalog_media). */
      supabase: Awaited<ReturnType<typeof createClient>>;
      service: ReturnType<typeof createServiceRoleClient>;
      isAdmin: boolean;
    }
  | { ok: false; response: Response };

function deny(reason: string, status: number): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ ok: false, reason }, { status }) };
}

/** Ligne d'établissement telle que lue par les deux chemins ci-dessous. */
type EstablishmentRow = {
  lobby_api_token: string | null;
  lobby_connector_active: boolean | null;
  lobby_has_token: boolean | null;
} | null;

/**
 * Valide qu'un établissement est réellement connecté et en extrait de quoi appeler Lobby. Séparé
 * de la garde d'autorisation parce que les deux chemins d'accès diffèrent : le sélecteur part d'un
 * `establishmentId` fourni par l'écran, l'import-rattachement part d'un `productId` dont on REMONTE
 * l'établissement en base (jamais du corps de requête, qui ne doit désigner que la ressource).
 */
export function lobbyCredentials(
  establishment: EstablishmentRow,
):
  | { ok: true; apiToken: string; baseUrl: string; relaySecret: string | undefined }
  | { ok: false; response: Response } {
  if (!establishment) return deny("establishment_not_found", 404);
  if (!establishment.lobby_connector_active || !establishment.lobby_has_token) {
    return deny("pms_not_connected", 409);
  }
  return {
    ok: true,
    apiToken: establishment.lobby_api_token as string,
    // Volontairement lu ICI et pas dans packages/domain : lobbyClient.ts pose comme décision
    // d'architecture que baseUrl/apiToken sont toujours des paramètres explicites, jamais lus
    // depuis l'environnement à l'intérieur du module — c'est ce qui lui permet de tourner en Node,
    // en Deno et contre le serveur de fixtures.
    baseUrl: process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL,
    relaySecret: process.env.LOBBY_RELAY_SECRET,
  };
}

/**
 * Vérifie que l'appelant a le droit d'agir sur les données Lobby de cet établissement, et renvoie
 * de quoi appeler Lobby. `requireAdmin` couvre les gestes réservés à l'admin (rattachement direct
 * d'un média à un produit existant) ; sinon la règle est « admin OU operator actif sur CET
 * établissement », jamais « authentifié ».
 */
export async function resolveLobbyEstablishment(
  establishmentId: string | null,
  options: { requireAdmin?: boolean } = {},
): Promise<LobbyEstablishmentAccess> {
  if (!establishmentId) return deny("invalid_params", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return deny("not_authenticated", 401);

  const service = createServiceRoleClient();

  // Les trois lectures ne dépendent que de `user.id`/`establishmentId`, jamais l'une de l'autre :
  // une seule vague au lieu des trois séquentielles d'avant (~1 aller-retour Supabase économisé à
  // chaque ouverture du sélecteur). Toutes les autorisations restent évaluées AVANT le premier
  // appel Lobby et avant toute écriture Storage.
  const [{ data: isAdmin }, { data: hasOperator }, { data: establishment }] = await Promise.all([
    supabase.rpc("is_admin", { uid: user.id }),
    supabase.rpc("has_capability", {
      uid: user.id,
      p_role: "operator",
      p_establishment_id: establishmentId,
    }),
    service
      .from("establishments")
      .select("id, lobby_api_token, lobby_connector_active, lobby_has_token")
      .eq("id", establishmentId)
      .maybeSingle(),
  ]);

  if (options.requireAdmin && !isAdmin) return deny("not_authorized", 403);
  if (!isAdmin && !hasOperator) return deny("not_authorized", 403);

  const credentials = lobbyCredentials(establishment);
  if (!credentials.ok) return credentials;

  return {
    ok: true,
    establishmentId,
    apiToken: credentials.apiToken,
    baseUrl: credentials.baseUrl,
    relaySecret: credentials.relaySecret,
    supabase,
    service,
    isAdmin: Boolean(isAdmin),
  };
}

const MAX_PAGES = 20;

export type LobbyPageCollection<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: "lobby_rejected"; status: number };

/**
 * Parcourt les pages de LobbyPMS et accumule les éléments, sans doublon.
 *
 * Deux sorties, dans cet ordre :
 *   1. `meta.total_pages` quand Lobby le renvoie — la sortie rapide, 1 seul appel pour un compte
 *      d'une page.
 *   2. « aucun identifiant nouveau sur cette page » — le filet, qui ne suppose RIEN de Lobby.
 *
 * Le filet n'est pas théorique : `meta` n'a jamais été observé dans une réponse réelle (la sonde du
 * 2026-08-26 n'a capturé que le début du corps, qui ne contenait que `data`), et cette clé vient
 * d'une doc déjà prise en défaut une fois sur `POST /bookings`. Si `meta` manque ET que Lobby borne
 * une page hors plage à la dernière page — comportement courant — la version précédente tapait les
 * 20 pages et renvoyait 20 copies des mêmes catégories dans le sélecteur. La déduplication supprime
 * les deux défauts d'un coup et rend `MAX_PAGES` à son rôle de vrai garde-fou, jamais atteint.
 */
export async function collectLobbyPages<T>(
  fetchPage: (page: number) => Promise<LobbyCallResult>,
  parse: (body: unknown) => T[],
  getKey: (item: T) => number,
): Promise<LobbyPageCollection<T>> {
  const items: T[] = [];
  const seen = new Set<number>();
  let totalPages: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchPage(page);
    if (response.status !== 200) {
      return { ok: false, reason: "lobby_rejected", status: response.status };
    }

    let addedOnThisPage = 0;
    for (const item of parse(response.body)) {
      const key = getKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      addedOnThisPage += 1;
    }
    if (addedOnThisPage === 0) break;

    totalPages = parseLobbyPageMeta(response.body).totalPages ?? totalPages;
    if (totalPages !== null && page >= totalPages) break;
  }

  return { ok: true, items };
}
