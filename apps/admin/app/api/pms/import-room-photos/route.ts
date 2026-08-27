import sharp from "sharp";
import {
  fetchLobbyPhoto,
  getLobbyRooms,
  parseLobbyRooms,
  remainingPhotoSlots,
  type LobbyRoomCategory,
} from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import {
  collectLobbyPages,
  lobbyCredentials,
  resolveLobbyEstablishment,
} from "@/lib/pms/lobbyEstablishment";
import { lobbyImportMode } from "@/lib/pms/lobbyImportMode";

// Importe les photos que LobbyPMS détient déjà pour la catégorie à laquelle un logement est lié.
// Sans ça, une chambre PMS-backed ne pouvait structurellement avoir aucune image et sa carte de
// catalogue public s'affichait vide.
//
// DEUX MODES, parce que le produit n'existe pas toujours encore (retour Jérôme, 2026-08-26 :
// « à la proposition il faut les lier les images et autres infos captées par Lobby ») :
//
//   attach { productId }                      — admin seul, produit existant.
//     Écrit dans product_media via add_catalog_media.
//   stage  { establishmentId, categoryId, … } — admin OU operator actif sur l'établissement.
//     N'écrit AUCUNE ligne DB : dépose les fichiers dans Storage et renvoie leurs storage_path,
//     que l'appelant range dans ses photos « stagées » (StagedPhoto{path,url}). Elles voyagent
//     alors dans payload.photos[] et sont rattachées à l'approbation par
//     create_product_from_proposal — le chemin qu'empruntent déjà les photos uploadées à la main.
//
// Pourquoi `stage` n'est pas admin-only alors que « Desvincular »/« Actualizar » le sont : ces
// deux gestes-là MODIFIENT un lien dont dépendent des réservations, alors qu'importer les photos
// de sa propre catégorie dans sa propre proposition ne touche aucun lien et n'expose rien de neuf
// — le socio voit déjà ces mêmes URLs dans la carte de prévisualisation.
//
// Le mode est NOMMÉ avant de brancher (/simplify 2026-08-26). Avant, un commentaire affirmait que
// la sûreté venait de l'ordre des branches — c'est faux, et ça protégeait la mauvaise propriété :
// ce qui la garantit est que le prédicat du mode faible est exactement « productId absent ».
// Quelqu'un qui aurait « nettoyé » en `if (!body.productId)` — idiome courant — aurait fait
// basculer `{productId: "", establishmentId, categoryId}` du 400 vers la garde socio, en silence.
export const runtime = "nodejs";
// sharp + plusieurs téléchargements séquentiels : la valeur par défaut de Vercel serait trop courte.
export const maxDuration = 60;

const BUCKET = "catalog-media";
const MAX_DIMENSION = 2400;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

type SkippedPhoto = { url: string; reason: string };
type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** URLs des photos que Lobby détient pour UNE catégorie. Partagé par les deux modes. */
async function lobbyPhotoUrlsFor(
  baseUrl: string,
  apiToken: string,
  relaySecret: string | undefined,
  categoryId: number,
): Promise<{ ok: true; urls: string[] } | { ok: false; reason: string; status?: number }> {
  const collected = await collectLobbyPages<LobbyRoomCategory>(
    (page) => getLobbyRooms(baseUrl, apiToken, page, relaySecret),
    parseLobbyRooms,
    (category) => category.categoryId,
  );
  if (!collected.ok) return { ok: false, reason: collected.reason, status: collected.status };

  const match = collected.items.find((category) => category.categoryId === categoryId);
  // Catégorie absente de la liste : traité comme « aucune photo », jamais comme une erreur — elle
  // a pu être supprimée chez Lobby depuis que le lien a été posé.
  return { ok: true, urls: match ? match.photos : [] };
}

/**
 * Télécharge UNE photo et la réécrit dans Storage. Ne touche JAMAIS la base : c'est précisément ce
 * qui permet aux deux modes de partager ce code — le rattachement (ou son absence) reste la
 * responsabilité de l'appelant.
 */
async function downloadToStorage(
  url: string,
  service: ServiceClient,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const fetched = await fetchLobbyPhoto(url);
  if (!fetched.ok) return { ok: false, reason: fetched.reason };

  // Le format est déterminé par sharp à partir des octets, jamais par le Content-Type annoncé.
  // Même pipeline que api/upload/[entity] : rotation EXIF, redimensionnement sans agrandir,
  // encodage WebP (qui n'emporte pas l'EXIF de la source).
  let outputBuffer: Buffer;
  try {
    const image = sharp(Buffer.from(fetched.bytes), { limitInputPixels: 60_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return { ok: false, reason: "unsupported_format" };
    }
    outputBuffer = await image
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
  } catch {
    return { ok: false, reason: "decode_failed" };
  }

  const objectPath = `products/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(objectPath, outputBuffer, { contentType: "image/webp" });
  if (uploadError) return { ok: false, reason: "upload_failed" };

  return { ok: true, path: objectPath };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }
  // Le choix de mode est une décision de sécurité : il vit dans une fonction pure testée
  // (lib/pms/lobbyImportMode.ts), pas dans une condition inline que le prochain « nettoyage »
  // réécrirait en `if (!body.productId)` sans voir qu'il déplace une frontière d'autorisation.
  const mode = lobbyImportMode(body);
  if (mode === "invalid") {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const input = body as {
    productId?: unknown;
    establishmentId?: unknown;
    categoryId?: unknown;
    alreadyStaged?: unknown;
  };
  return mode === "attach" ? handleAttach(input) : handleStage(input);
}

// ───────────────────────────── Mode « stage » (mise en attente) ─────────────────────────────
async function handleStage(input: {
  establishmentId?: unknown;
  categoryId?: unknown;
  alreadyStaged?: unknown;
}) {
  const { establishmentId, categoryId } = input;
  if (typeof establishmentId !== "string" || !Number.isInteger(categoryId)) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const access = await resolveLobbyEstablishment(establishmentId);
  if (!access.ok) return access.response;

  // Le nombre déjà en attente vient du client (aucune ligne DB n'existe encore pour le compter).
  // Il ne peut donc que RÉDUIRE le travail sortant, jamais l'augmenter — et de toute façon
  // submit_product_creation_proposal refuse toute proposition à plus de 6 photos.
  const staged = Number(input.alreadyStaged);
  const slots = remainingPhotoSlots(Number.isFinite(staged) ? Math.floor(staged) : 0);
  if (slots === 0) {
    return Response.json({ ok: true, photos: [], skipped: [], reason: "gallery_full" });
  }

  let urls: string[];
  try {
    const found = await lobbyPhotoUrlsFor(
      access.baseUrl,
      access.apiToken,
      access.relaySecret,
      categoryId as number,
    );
    if (!found.ok) {
      return Response.json({ ok: false, reason: found.reason, status: found.status }, { status: 502 });
    }
    urls = found.urls;
  } catch (error) {
    console.error(`import-room-photos (stage) : GET /rooms a échoué (établissement ${establishmentId})`, error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }

  if (urls.length === 0) {
    return Response.json({ ok: true, photos: [], skipped: [], reason: "no_photos_in_lobby" });
  }

  const photos: { path: string; url: string }[] = [];
  const skipped: SkippedPhoto[] = [];
  for (const url of urls.slice(0, slots)) {
    const stored = await downloadToStorage(url, access.service);
    if (!stored.ok) {
      skipped.push({ url, reason: stored.reason });
      continue;
    }
    // URL publique du bucket : la galerie en attente a besoin d'afficher une vignette avant que la
    // moindre ligne DB existe (même contrat que StagedPhoto{path,url}).
    photos.push({
      path: stored.path,
      url: access.service.storage.from(BUCKET).getPublicUrl(stored.path).data.publicUrl,
    });
  }

  return Response.json({ ok: true, photos, skipped });
}

// ───────────────────────── Mode « attach » (rattachement, admin seul) ─────────────────────────
async function handleAttach(input: { productId?: unknown }) {
  const { productId } = input;
  if (typeof productId !== "string" || productId.length === 0) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "not_authenticated" }, { status: 401 });

  // Garde doublée : is_admin vérifié tôt pour une 403 propre, et add_catalog_media la re-vérifie
  // de toute façon côté base (elle est SECURITY DEFINER).
  const { data: isAdmin } = await supabase.rpc("is_admin", { uid: user.id });
  if (!isAdmin) return Response.json({ ok: false, reason: "not_authorized" }, { status: 403 });

  const service = createServiceRoleClient();

  // La catégorie Lobby et l'établissement sont relus en base à partir du seul productId — jamais
  // pris dans le corps de la requête, qui ne doit pouvoir désigner que la ressource, pas la cible.
  const { data: product } = await service
    .from("products")
    .select("id, type, lobby_category_id, establishment_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return Response.json({ ok: false, reason: "product_not_found" }, { status: 404 });
  if (product.type !== "lodging" || product.lobby_category_id == null) {
    return Response.json({ ok: false, reason: "not_pms_backed" }, { status: 409 });
  }

  const { data: establishment } = await service
    .from("establishments")
    .select("lobby_api_token, lobby_connector_active, lobby_has_token")
    .eq("id", product.establishment_id)
    .maybeSingle();
  const credentials = lobbyCredentials(establishment);
  if (!credentials.ok) return credentials.response;

  // Le plafond de 6 est appliqué par add_catalog_media, donc APRÈS téléchargement, décodage et
  // écriture Storage — il ne borne pas le travail sortant. On coupe donc ici, avant le premier
  // fetch : c'est tout l'intérêt de remainingPhotoSlots.
  const { count } = await service
    .from("product_media")
    .select("id", { count: "exact", head: true })
    .eq("product_id", product.id);
  const slots = remainingPhotoSlots(count ?? 0);
  if (slots === 0) {
    return Response.json({ ok: true, imported: 0, skipped: [], reason: "gallery_full" });
  }

  let photoUrls: string[];
  try {
    const found = await lobbyPhotoUrlsFor(
      credentials.baseUrl,
      credentials.apiToken,
      credentials.relaySecret,
      product.lobby_category_id,
    );
    if (!found.ok) {
      return Response.json({ ok: false, reason: found.reason, status: found.status }, { status: 502 });
    }
    photoUrls = found.urls;
  } catch (error) {
    console.error(`import-room-photos : GET /rooms a échoué (produit ${product.id})`, error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }

  if (photoUrls.length === 0) {
    // Cas parfaitement normal : tous les comptes Lobby ne renseignent pas de photos. Le dire, plutôt
    // que de renvoyer un succès muet qui laisserait croire à un bug d'affichage.
    return Response.json({ ok: true, imported: 0, skipped: [], reason: "no_photos_in_lobby" });
  }

  const skipped: SkippedPhoto[] = [];
  let imported = 0;

  for (const url of photoUrls.slice(0, slots)) {
    const stored = await downloadToStorage(url, service);
    if (!stored.ok) {
      skipped.push({ url, reason: stored.reason });
      continue;
    }

    // add_catalog_media est appelée avec le client de l'ADMIN connecté (elle exige is_admin), pas
    // avec service_role. Si elle refuse — plafond atteint entre-temps, produit disparu — l'objet
    // déjà écrit dans Storage est retiré : aucun call site du dépôt ne faisait ce nettoyage, et un
    // orphelin dans le bucket ne se voit nulle part.
    const { error: rpcError } = await supabase.rpc("add_catalog_media", {
      p_entity_type: "product",
      p_entity_id: product.id,
      p_storage_path: stored.path,
    });
    if (rpcError) {
      await service.storage.from(BUCKET).remove([stored.path]);
      skipped.push({ url, reason: "attach_failed" });
      continue;
    }
    imported += 1;
  }

  return Response.json({ ok: true, imported, skipped });
}
