import sharp from "sharp";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";

// sharp a besoin de bindings natifs — incompatible avec le runtime edge.
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_DIMENSION = 2400;
const BUCKET = "catalog-media";

// Upload canonique de tout le module images (spec docs/specs/04-gestion-images.md §7) — admin ET
// socio passent par CE MÊME Route Handler, jamais un chemin distinct par rôle (contrairement au
// fork admin/socio du legacy, `imageUpload.js`, qui n'a plus de raison d'être ici : Vercel n'a de
// toute façon aucun disque persistant à écrire pour personne). Ne fait QUE traiter le fichier et
// l'écrire dans Storage — retourne un storage_path que l'appelant attache ensuite à une entité via
// add_catalog_media (admin) ou submit_photos_proposal (socio), jamais d'écriture DB ici.
export async function POST(request: Request, context: RouteContext<"/api/upload/[entity]">) {
  const { entity } = await context.params;
  if (entity !== "product" && entity !== "establishment") {
    return Response.json({ ok: false, reason: "invalid_entity" }, { status: 400 });
  }

  // Auth vérifiée AVANT toute lecture du body (contre C29, docs/4-pilotage/backlog.md:871-894) —
  // la session est la toute première chose lue dans ce corps de fonction, avant même
  // request.formData(). Un upload sans session ne déclenche jamais aucune écriture Storage.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, reason: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, reason: "file_too_large" }, { status: 413 });
  }

  // Buffer 100% en mémoire — jamais fs.writeFile (contre le gap G5, aucun fichier utilisateur ne
  // touche jamais un disque local à aucune étape).
  const inputBuffer = Buffer.from(await file.arrayBuffer());

  const image = sharp(inputBuffer, { limitInputPixels: 60_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    return Response.json({ ok: false, reason: "unsupported_format" }, { status: 415 });
  }

  // Rotation EXIF puis strip métadonnées (implicite : .webp() n'emporte pas l'EXIF de la source),
  // resize sans agrandir, encodage WebP — paramètres repris à l'identique du pipeline socio legacy
  // déjà prouvé en production (src/services/mediaService.js:165-229).
  const outputBuffer = await image
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer();

  const folder = entity === "product" ? "products" : "establishments";
  const objectPath = `${folder}/${crypto.randomUUID()}.webp`;

  // service_role : seul chemin d'écriture dans le bucket pour un upload réel (défense en
  // profondeur mise à part, cf. migration 20260815110000_gestion_images.sql) — contourne RLS
  // volontairement, jamais présenté comme un filet RLS (hifago/CLAUDE.md §3.5).
  const service = createServiceRoleClient();
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(objectPath, outputBuffer, { contentType: "image/webp" });

  if (uploadError) {
    return Response.json({ ok: false, reason: "upload_failed" }, { status: 500 });
  }

  return Response.json({ ok: true, storage_path: objectPath });
}
