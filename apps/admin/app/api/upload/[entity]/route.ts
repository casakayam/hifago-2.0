import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { MAX_IMAGE_BYTES, toCatalogWebp, uploadCatalogWebp } from "@/lib/media/catalogImage";

// sharp a besoin de bindings natifs — incompatible avec le runtime edge (le pipeline vit dans
// @/lib/media/catalogImage, mais il s'exécute ici).
export const runtime = "nodejs";

// Upload canonique de tout le module images (spec docs/specs/04-gestion-images.md §7) — admin ET
// socio passent par CE MÊME Route Handler, jamais un chemin distinct par rôle (contrairement au
// fork admin/socio du legacy, `imageUpload.js`, qui n'a plus de raison d'être ici : Vercel n'a de
// toute façon aucun disque persistant à écrire pour personne). Ne fait QUE traiter le fichier et
// l'écrire dans Storage — retourne un storage_path que l'appelant attache ensuite à une entité via
// add_catalog_media (admin) ou submit_photos_proposal (socio), jamais d'écriture DB ici.
//
// Le décodage/réencodage et l'écriture Storage sont partagés avec api/pms/import-room-photos
// (/simplify 2026-08-27) : les deux chemins aboutissent au même bucket, ils doivent produire le
// même rendu.
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
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ ok: false, reason: "file_too_large" }, { status: 413 });
  }

  // Buffer 100% en mémoire — jamais fs.writeFile (contre le gap G5, aucun fichier utilisateur ne
  // touche jamais un disque local à aucune étape).
  const inputBuffer = Buffer.from(await file.arrayBuffer());

  const processed = await toCatalogWebp(inputBuffer);
  if (!processed.ok) {
    return Response.json(
      { ok: false, reason: processed.reason },
      { status: processed.reason === "unsupported_format" ? 415 : 400 },
    );
  }

  const service = createServiceRoleClient();
  const stored = await uploadCatalogWebp(
    service,
    entity === "product" ? "products" : "establishments",
    processed.buffer,
  );
  if (!stored.ok) {
    return Response.json({ ok: false, reason: "upload_failed" }, { status: 500 });
  }

  return Response.json({ ok: true, storage_path: stored.path });
}
