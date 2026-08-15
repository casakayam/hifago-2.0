import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { resolvePageParams } from "@hifago/domain";
import { buttonVariants, Chip, ServerPagination, Table } from "@hifago/ui";
import { RevokeInvitationButton } from "./RevokeInvitationButton";

const ONBOARDING_PATH_LABELS: Record<string, string> = {
  referrer: "Referente",
  provider: "Prestador",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  consumed: "Consumida",
  revoked: "Revocada",
  expired: "Expirada",
};

const STATUS_CHIP_COLOR: Record<string, "default" | "accent" | "success" | "danger"> = {
  pending: "accent",
  consumed: "success",
  revoked: "danger",
  expired: "default",
};

type InvitationRow = {
  id: string;
  promo_code: string;
  onboarding_path: string;
  status: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_account_id: string | null;
  partner_id: string | null;
  created_at: string;
};

// docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.3 — jusqu'ici seul
// /admin/invitations/new existait, aucun suivi de ce qui a été envoyé/consommé/expiré. Lecture
// directe (pas de RPC) : partner_invitations_select_admin et partner_capabilities_select
// (20260813163456_identity_rls.sql) accordent déjà le select admin sur les deux tables.
export default async function AdminInvitationsPage({
  searchParams,
}: PageProps<"/admin/invitations">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();

  const { data: invitations, count } = await supabase
    .from("partner_invitations")
    .select(
      "id, promo_code, onboarding_path, status, expires_at, consumed_at, consumed_by_account_id, partner_id, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  const rows = (invitations ?? []) as InvitationRow[];

  // Résolution du partenaire pour les invitations Prestador consommées, sans partner_id déjà
  // renseigné (cf. spec §5.3 — create_partner_invitation, Feature 13, ne renseigne jamais
  // partner_invitations.partner_id après consommation, contrairement à create_partner_direct).
  const candidates = rows.filter((row) => row.status === "consumed" && row.onboarding_path === "provider");
  const accountIdsToResolve = Array.from(
    new Set(
      candidates
        .filter((row) => row.partner_id === null && row.consumed_by_account_id !== null)
        .map((row) => row.consumed_by_account_id as string)
    )
  );

  const accountToPartner = new Map<string, string | null>();
  if (accountIdsToResolve.length > 0) {
    const { data: accounts } = await supabase
      .from("partner_accounts")
      .select("id, partner_id")
      .in("id", accountIdsToResolve);
    for (const account of accounts ?? []) {
      accountToPartner.set(account.id, account.partner_id);
    }
  }

  const resolvedPartnerByInvitation = new Map<string, string>();
  for (const row of candidates) {
    const resolved = row.partner_id ?? (row.consumed_by_account_id ? accountToPartner.get(row.consumed_by_account_id) : null);
    if (resolved) resolvedPartnerByInvitation.set(row.id, resolved);
  }

  const candidatePartnerIds = Array.from(new Set(Array.from(resolvedPartnerByInvitation.values())));
  const partnersMissingEstablishment = new Set<string>();
  if (candidatePartnerIds.length > 0) {
    const { data: pendingCapabilities } = await supabase
      .from("partner_capabilities")
      .select("partner_id")
      .eq("role", "operator")
      .is("establishment_id", null)
      .in("partner_id", candidatePartnerIds);
    for (const capability of pendingCapabilities ?? []) {
      if (capability.partner_id) partnersMissingEstablishment.add(capability.partner_id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invitaciones</h1>
        <Link href="/admin/invitations/new" className={buttonVariants()} data-testid="new-invitation-link">
          Nueva invitación
        </Link>
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Invitaciones">
            <Table.Header>
              <Table.Column isRowHeader>Código</Table.Column>
              <Table.Column>Tipo</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column>Creada</Table.Column>
              <Table.Column>Expira</Table.Column>
              <Table.Column>Consumida</Table.Column>
              <Table.Column></Table.Column>
            </Table.Header>
            <Table.Body>
              {rows.length > 0 ? (
                rows.map((row) => {
                  const missingEstablishment =
                    resolvedPartnerByInvitation.has(row.id) &&
                    partnersMissingEstablishment.has(resolvedPartnerByInvitation.get(row.id) as string);
                  return (
                    <Table.Row key={row.id} data-testid={`invitation-row-${row.id}`}>
                      <Table.Cell>{row.promo_code}</Table.Cell>
                      <Table.Cell>{ONBOARDING_PATH_LABELS[row.onboarding_path] ?? row.onboarding_path}</Table.Cell>
                      <Table.Cell>
                        <Chip variant="soft" color={STATUS_CHIP_COLOR[row.status] ?? "default"}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>{new Date(row.created_at).toLocaleDateString("es")}</Table.Cell>
                      <Table.Cell>{new Date(row.expires_at).toLocaleDateString("es")}</Table.Cell>
                      <Table.Cell>
                        {row.consumed_at ? new Date(row.consumed_at).toLocaleDateString("es") : "—"}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-3">
                          {missingEstablishment ? (
                            <Link
                              href={`/admin/establishments/new?partner_id=${resolvedPartnerByInvitation.get(row.id)}`}
                              className="text-sm font-medium text-warning hover:underline"
                              data-testid={`invitation-missing-establishment-${row.id}`}
                            >
                              Falta establecimiento
                            </Link>
                          ) : null}
                          {row.status === "pending" ? (
                            <RevokeInvitationButton invitationId={row.id} />
                          ) : null}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={7} className="text-center text-muted">
                    Ninguna invitación encontrada.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <ServerPagination page={page} pageSize={pageSize} totalCount={count ?? 0} basePath="/admin/invitations" />
    </div>
  );
}
