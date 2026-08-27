import sharp from "sharp";
import type { createServiceRoleClient } from "@hifago/supabase/service";

// Pipeline image du catalogue, défini UNE fois (/simplify du 2026-08-27). Il était recopié à
// l'identique entre api/upload/[entity]/route.ts (upload manuel, admin ET socio) et
// api/pms/import-room-photos/route.ts (import depuis LobbyPMS) : 11 lignes strictement identiques
// plus trois constantes. Le commentaire de l'import RECONNAISSAIT la copie (« même pipeline que
// api/upload/[entity] ») sans la justifier.
//
// Ce que la duplication coûtait concrètement : régler la qualité WebP ou MAX_DIMENSION d'un seul
// côté ferait cohabiter dans la MÊME galerie des photos importées et des photos uploadées avec des
// rendus différents — sans aucun signal, puisque les deux chemins aboutissent au même bucket.
//
// Volontairement dans apps/admin et PAS dans packages/domain : `sharp` n'est déclaré que dans
// apps/admin/package.json, et les Edge Functions Deno importent directement depuis
// packages/domain/src (cf. pms-nightly-contract-check) — y mettre du sharp casserait ce chemin.

export const CATALOG_MEDIA_BUCKET = "catalog-media";

/**
 * Plafond d'octets d'une image du catalogue.
 * ⚠️ `packages/domain/src/pms/fetchLobbyPhoto.ts` porte la même valeur en dur : il ne peut pas
 * importer ce module (il tourne aussi en Deno), donc l'alignement est documenté des deux côtés
 * plutôt que garanti par le typage. Modifier l'un impose de modifier l'autre.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MAX_DIMENSION = 2400;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type CatalogImageFolder = "products" | "establishments";

export type ProcessResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "unsupported_format" | "decode_failed" };

/**
 * Décode, redresse et réencode une image en WebP.
 *
 * Le format est déterminé par sharp À PARTIR DES OCTETS, jamais par un Content-Type annoncé ou une
 * extension : les deux appelants reçoivent leur binaire d'une source non fiable (un fichier
 * utilisateur, ou une URL chez LobbyPMS). `rotate()` applique l'orientation EXIF avant le
 * redimensionnement, et `.webp()` n'emporte pas l'EXIF de la source — les métadonnées (dont la
 * géolocalisation d'une photo de téléphone) ne survivent donc pas à ce passage.
 *
 * `limitInputPixels` borne la bombe de décompression : une image déclarant des dimensions énormes
 * est refusée avant d'allouer son bitmap.
 */
export async function toCatalogWebp(input: Buffer): Promise<ProcessResult> {
  try {
    const image = sharp(input, { limitInputPixels: 60_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return { ok: false, reason: "unsupported_format" };
    }
    const buffer = await image
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
    return { ok: true, buffer };
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
}

/**
 * Écrit un WebP déjà traité dans le bucket. service_role : seul chemin d'écriture réel dans le
 * bucket, contourne RLS volontairement — jamais présenté comme un filet RLS (hifago/CLAUDE.md §3.5),
 * et TOUJOURS appelé après que le Route Handler a vérifié la session ET l'autorisation.
 * N'écrit AUCUNE ligne en base : le rattachement (add_catalog_media / payload de proposition) reste
 * la responsabilité de l'appelant.
 */
export async function uploadCatalogWebp(
  service: ReturnType<typeof createServiceRoleClient>,
  folder: CatalogImageFolder,
  buffer: Buffer,
): Promise<{ ok: true; path: string } | { ok: false; reason: "upload_failed" }> {
  const objectPath = `${folder}/${crypto.randomUUID()}.webp`;
  const { error } = await service.storage
    .from(CATALOG_MEDIA_BUCKET)
    .upload(objectPath, buffer, { contentType: "image/webp" });
  if (error) return { ok: false, reason: "upload_failed" };
  return { ok: true, path: objectPath };
}
