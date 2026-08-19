import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolvePageParams } from "@hifago/domain";
import { buttonVariants, ServerPagination } from "@hifago/ui";
import { ProductsGrid, type ProductCardRow } from "./ProductsGrid";
import { PendingProductCreationsList } from "./PendingProductCreationsList";

const PAGE_SIZE = 12;

type ProductQueryRow = {
  id: string;
  type: string;
  name: unknown;
  price_cop: number | null;
  category: string | null;
  sellable: boolean;
  establishments: { name: unknown } | null;
  product_tag_assignments: { catalog_tags: { id: string; label: unknown } | null }[];
};

type PendingCreationProposalRow = {
  id: string;
  type: string | null;
  payload: unknown;
  establishment_id: string | null;
  created_at: string;
  establishments: { name: unknown } | null;
};

export default async function PartnerProductsPage({
  searchParams,
}: PageProps<"/partner/products">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/products");
  }

  // partner_id_for_account (même RPC que la garde admin/layout.tsx utilise pour is_admin) — pas
  // une jointure ni un filtre manuel sur establishments, cf. plan feature 15.
  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const { page, pageSize, from, to } = resolvePageParams(await searchParams, PAGE_SIZE);

  // products_select_own (feature 15, additive à products_select_public) : couvre aussi les
  // fiches sellable=false de ce partenaire, pas seulement les publiées — sans elle, cette liste
  // serait vide pour toute fiche pas encore publiée. establishments(name) et
  // product_tag_assignments(catalog_tags(...)) : imbrication à 2 niveaux, même pattern que
  // admin/products/page.tsx pour establishments(name) — RLS déjà vérifiée (product_media,
  // product_tag_assignments et catalog_tags héritent de la visibilité du produit parent, cf. plan).
  //
  // pendingCreationsRaw (spec 15, propositions de création en attente) ne dépend lui aussi que de
  // partnerId déjà connu à ce point — lancé en parallèle plutôt qu'après cette requête ET après le
  // Promise.all productIds-dépendant plus bas, pour ne pas sérialiser 3 allers-retours Supabase.
  const [
    { data: products, count },
    { data: pendingCreationsRaw },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, type, name, price_cop, category, sellable, establishments(name), product_tag_assignments(catalog_tags(id, label))",
        { count: "exact" },
      )
      .eq("partner_id", partnerId ?? "")
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<ProductQueryRow[]>(),
    // Spec 15 — propositions de création en attente, plafond 1 PAR ÉTABLISSEMENT (pas par
    // partenaire) : un socio multi-établissements peut en avoir plusieurs en parallèle, jamais un
    // singleton comme la bannière établissement. establishments(name) : la carte pending affiche
    // désormais l'établissement rattaché comme n'importe quelle autre carte de la grille.
    partnerId
      ? supabase
          .from("product_proposals")
          .select("id, type, payload, establishment_id, created_at, establishments(name)")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .returns<PendingCreationProposalRow[]>()
      : Promise.resolve({ data: null as PendingCreationProposalRow[] | null }),
  ]);

  const productIds = (products ?? []).map((p) => p.id);

  // 3 vagues dépendantes des id de la page courante (même idiome que roomIds/room_media dans
  // admin/products/[id]/edit/page.tsx) — jamais lancées si la page est vide. product_slot_rules :
  // même signal que slotRulesRaw.length côté admin/products/[id]/edit/page.tsx, pour ne montrer le
  // lien "Cupos por horario" (spec 18 Tranche 1) que sur une activité qui porte réellement au moins
  // une règle de créneaux.
  const [{ data: mediaRaw }, { data: pendingEditsRaw }, { data: slotRulesRaw }] =
    productIds.length > 0
      ? await Promise.all([
          supabase
            .from("product_media")
            .select("id, product_id, storage_path")
            .in("product_id", productIds)
            .order("sort", { ascending: true }),
          supabase
            .from("product_proposals")
            .select("product_id")
            .in("product_id", productIds)
            .eq("kind", "content")
            .eq("status", "pending"),
          supabase.from("product_slot_rules").select("product_id").in("product_id", productIds),
        ])
      : [
          { data: [] as { id: string; product_id: string; storage_path: string }[] },
          { data: [] as { product_id: string | null }[] },
          { data: [] as { product_id: string }[] },
        ];

  const photosByProduct = new Map<string, { id: string; url: string }[]>();
  for (const media of mediaRaw ?? []) {
    const url = supabase.storage.from("catalog-media").getPublicUrl(media.storage_path).data.publicUrl;
    const list = photosByProduct.get(media.product_id) ?? [];
    list.push({ id: media.id, url });
    photosByProduct.set(media.product_id, list);
  }

  const pendingEditProductIds = new Set((pendingEditsRaw ?? []).map((p) => p.product_id));
  const slotRulesProductIds = new Set((slotRulesRaw ?? []).map((r) => r.product_id));

  const pendingCreations = (pendingCreationsRaw ?? []).map((proposal) => ({
    id: proposal.id,
    type: proposal.type,
    payload: proposal.payload,
    establishment_id: proposal.establishment_id,
    created_at: proposal.created_at,
    establishmentName: resolveLocalizedField(asLocalizedField(proposal.establishments?.name), "es"),
  }));

  const rows: ProductCardRow[] = (products ?? []).map((product) => {
    const name = resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id;
    return {
      id: product.id,
      type: product.type,
      name,
      priceCop: product.price_cop,
      sellable: product.sellable,
      establishmentName: resolveLocalizedField(asLocalizedField(product.establishments?.name), "es"),
      tags: (product.product_tag_assignments ?? [])
        .map((a) => (a.catalog_tags ? resolveLocalizedField(asLocalizedField(a.catalog_tags.label), "es") : null))
        .filter((label): label is string => Boolean(label)),
      photos: (photosByProduct.get(product.id) ?? []).map((photo) => ({ id: photo.id, url: photo.url, alt: name })),
      pendingEdit: pendingEditProductIds.has(product.id),
      hasSlotRules: slotRulesProductIds.has(product.id),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mis actividades</h1>
        <Link
          href="/partner/products/new"
          className={buttonVariants({ size: "sm" })}
          data-testid="propose-new-product-link"
        >
          Proponer una nueva ficha
        </Link>
      </div>

      <PendingProductCreationsList proposals={pendingCreations} />

      <ProductsGrid products={rows} />

      <ServerPagination page={page} pageSize={pageSize} totalCount={count ?? 0} basePath="/partner/products" />
    </div>
  );
}
