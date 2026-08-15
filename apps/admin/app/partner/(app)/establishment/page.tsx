import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Card, Chip, buttonVariants } from "@hifago/ui";
import { PendingCreationBanner } from "./PendingCreationBanner";

// docs/specs/06-gestion-etablissement.md §5.2 — jusqu'ici rien ne permettait à un partenaire de
// voir/gérer sa propre fiche établissement (absence totale, vérifié exhaustivement). Couvre
// indifféremment le partenaire avec un seul établissement et celui qui souhaite en proposer un
// supplémentaire : create_establishment (appelée à l'approbation) gère déjà les deux cas
// identiquement, cf. spec §1 — un seul écran, pas deux parcours.
export default async function PartnerEstablishmentListPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const partnerId = user
    ? (await supabase.rpc("partner_id_for_account", { uid: user.id })).data
    : null;

  const { data: establishments } = partnerId
    ? await supabase
        .from("establishments")
        .select("id, name")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: true })
    : { data: null };

  const { data: pendingEdits } = partnerId
    ? await supabase
        .from("establishment_proposals")
        .select("id, establishment_id")
        .eq("partner_id", partnerId)
        .eq("kind", "edit")
        .eq("status", "pending")
    : { data: null };

  const { data: pendingCreation } = partnerId
    ? await supabase
        .from("establishment_proposals")
        .select("id, payload, created_at")
        .eq("partner_id", partnerId)
        .eq("kind", "create")
        .eq("status", "pending")
        .maybeSingle()
    : { data: null };

  const pendingEditByEstablishment = new Map(
    (pendingEdits ?? []).map((p) => [p.establishment_id, p.id]),
  );

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

      <div className="flex flex-col gap-3" data-testid="establishment-list">
        {(establishments ?? []).length === 0 ? (
          <p className="text-sm text-muted">Aún no tienes ningún establecimiento rattachado.</p>
        ) : (
          (establishments ?? []).map((establishment) => {
            const pendingEditId = pendingEditByEstablishment.get(establishment.id);
            return (
              <Card key={establishment.id} data-testid={`establishment-row-${establishment.id}`}>
                <Card.Content className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {resolveLocalizedField(asLocalizedField(establishment.name), "es") ??
                        establishment.id}
                    </span>
                    {pendingEditId ? (
                      <Chip variant="soft" color="warning" data-testid="pending-edit-badge">
                        Edición pendiente de revisión
                      </Chip>
                    ) : null}
                  </div>
                  <Link
                    href={`/partner/establishment/${establishment.id}/edit`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`edit-establishment-link-${establishment.id}`}
                  >
                    Editar
                  </Link>
                </Card.Content>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
