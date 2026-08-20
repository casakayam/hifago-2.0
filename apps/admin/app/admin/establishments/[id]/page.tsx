import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EstablishmentPhotosBlock } from "./EstablishmentPhotosBlock";
import { EstablishmentEditBlock } from "./EstablishmentEditBlock";
import { EstablishmentPmsBlock } from "./EstablishmentPmsBlock";
import { EstablishmentStatusBlock } from "./EstablishmentStatusBlock";
import { EstablishmentProductsTable } from "./EstablishmentProductsTable";

export default async function AdminEstablishmentDetailPage({
  params,
}: PageProps<"/admin/establishments/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit n'importe quel établissement. Tous les champs de
  // présentation sont désormais éditables ici (docs/specs/06-gestion-etablissement.md §5.1) —
  // avant cette feature, seul `name` était lu (titre de page, lecture seule).
  // lobby_api_token n'est jamais lu (illisible même pour l'admin via PostgREST, cf. migration
  // 20260819110000_pms_connector_schema.sql) — lobby_has_token (dérivée, non secrète) suffit à
  // piloter l'affichage "token configurado".
  const { data: establishment } = await supabase
    .from("establishments")
    .select(
      "id, name, description, address, lat, lon, operated_directly, status, lobby_connector_active, lobby_has_token, lobby_last_synced_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!establishment) {
    notFound();
  }

  // Bandeau d'avertissement (spec 06 §5.1) : une seule requête select, pas de nouvelle RPC — évite
  // que l'admin modifie en aveugle pendant qu'une proposition d'édition du partner attend.
  const { data: pendingEditProposal } = await supabase
    .from("establishment_proposals")
    .select("id")
    .eq("establishment_id", establishment.id)
    .eq("kind", "edit")
    .eq("status", "pending")
    .maybeSingle();

  const { data: media } = await supabase
    .from("establishment_media")
    .select("id, storage_path")
    .eq("establishment_id", establishment.id)
    .order("sort", { ascending: true });

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées (sellable=false).
  const { data: products } = await supabase
    .from("products")
    .select("id, name, price_cop, sellable")
    .eq("establishment_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/establishments"
          className="text-sm text-muted hover:underline"
        >
          ← Establecimientos
        </Link>
        <h1 className="text-2xl font-semibold">
          {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
        </h1>
      </div>

      <EstablishmentStatusBlock establishmentId={establishment.id} initialStatus={establishment.status} />

      <EstablishmentEditBlock
        establishmentId={establishment.id}
        initialNameEs={asLocalizedField(establishment.name)?.es ?? ""}
        initialDescriptionEs={asLocalizedField(establishment.description)?.es ?? ""}
        initialDescriptionEn={asLocalizedField(establishment.description)?.en ?? ""}
        initialAddress={establishment.address ?? ""}
        initialLat={establishment.lat !== null ? String(establishment.lat) : ""}
        initialLon={establishment.lon !== null ? String(establishment.lon) : ""}
        initialOperatedDirectly={establishment.operated_directly}
        pendingEditProposalId={pendingEditProposal?.id ?? null}
      />

      <EstablishmentPmsBlock
        establishmentId={establishment.id}
        initialConnectorActive={establishment.lobby_connector_active}
        initialHasToken={establishment.lobby_has_token ?? false}
        initialLastSyncedAt={establishment.lobby_last_synced_at}
      />

      <EstablishmentPhotosBlock establishmentId={establishment.id} initialPhotos={photos} />

      <EstablishmentProductsTable products={products ?? []} />
    </div>
  );
}
