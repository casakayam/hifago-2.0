import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolvePageParams } from "@hifago/domain";
import { buttonVariants, ServerPagination } from "@hifago/ui";
import { PendingCreationBanner } from "./PendingCreationBanner";
import { EstablishmentsGrid, type EstablishmentCardRow } from "./EstablishmentsGrid";

const PAGE_SIZE = 12;

// docs/specs/06-gestion-etablissement.md §5.2 — jusqu'ici rien ne permettait à un partenaire de
// voir/gérer sa propre fiche établissement (absence totale, vérifié exhaustivement). Couvre
// indifféremment le partenaire avec un seul établissement et celui qui souhaite en proposer un
// supplémentaire : create_establishment (appelée à l'approbation) gère déjà les deux cas
// identiquement, cf. spec §1 — un seul écran, pas deux parcours.
export default async function PartnerEstablishmentListPage({
  searchParams,
}: PageProps<"/partner/establishment">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const partnerId = user
    ? (await supabase.rpc("partner_id_for_account", { uid: user.id })).data
    : null;

  const { page, pageSize, from, to } = resolvePageParams(await searchParams, PAGE_SIZE);

  // created_at desc (et non plus asc comme l'ancienne liste non paginée) : avec la pagination,
  // un ordre croissant ferait tomber tout établissement nouvellement créé hors de la page 1 dès
  // que le partenaire en a plus que PAGE_SIZE — même convention que /partner/products.
  //
  // Les trois requêtes ci-dessous ne dépendent que de `partnerId` (déjà résolu), jamais l'une de
  // l'autre — lancées en parallèle via Promise.all plutôt qu'attendues séquentiellement. Seule la
  // requête establishment_media reste un suivi dépendant (elle a besoin de establishmentIds, issu
  // du résultat de la première).
  const [{ data: establishments, count }, { data: pendingEdits }, { data: pendingCreation }] = await Promise.all([
    partnerId
      ? supabase
          .from("establishments")
          .select("id, name, status", { count: "exact" })
          .eq("partner_id", partnerId)
          .order("created_at", { ascending: false })
          .range(from, to)
      : { data: null, count: 0 },
    partnerId
      ? supabase
          .from("establishment_proposals")
          .select("id, establishment_id")
          .eq("partner_id", partnerId)
          .eq("kind", "edit")
          .eq("status", "pending")
      : { data: null },
    partnerId
      ? supabase
          .from("establishment_proposals")
          .select("id, payload, created_at")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .maybeSingle()
      : { data: null },
  ]);

  const establishmentIds = (establishments ?? []).map((e) => e.id);

  const { data: mediaRaw } =
    establishmentIds.length > 0
      ? await supabase
          .from("establishment_media")
          .select("id, establishment_id, storage_path")
          .in("establishment_id", establishmentIds)
          .order("sort", { ascending: true })
      : { data: [] as { id: string; establishment_id: string; storage_path: string }[] };

  const photosByEstablishment = new Map<string, { id: string; url: string }[]>();
  for (const media of mediaRaw ?? []) {
    const url = supabase.storage.from("catalog-media").getPublicUrl(media.storage_path).data.publicUrl;
    const list = photosByEstablishment.get(media.establishment_id) ?? [];
    list.push({ id: media.id, url });
    photosByEstablishment.set(media.establishment_id, list);
  }

  const pendingEditByEstablishment = new Map(
    (pendingEdits ?? []).map((p) => [p.establishment_id, p.id]),
  );

  const rows: EstablishmentCardRow[] = (establishments ?? []).map((establishment) => {
    const name = resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id;
    return {
      id: establishment.id,
      name,
      status: establishment.status,
      pendingEdit: pendingEditByEstablishment.has(establishment.id),
      photos: (photosByEstablishment.get(establishment.id) ?? []).map((photo) => ({
        id: photo.id,
        url: photo.url,
        alt: name,
      })),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mi establecimiento</h1>
        <Link
          href="/partner/establishment/new"
          className={buttonVariants({ size: "sm" })}
          data-testid="propose-new-establishment-link"
        >
          Proponer un nuevo establecimiento
        </Link>
      </div>

      {pendingCreation ? <PendingCreationBanner proposal={pendingCreation} /> : null}

      <EstablishmentsGrid establishments={rows} />

      {rows.length > 0 ? (
        <ServerPagination page={page} pageSize={pageSize} totalCount={count ?? 0} basePath="/partner/establishment" />
      ) : null}
    </div>
  );
}
