import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { Card, Chip } from "@hifago/ui";

const ROLE_LABELS: Record<string, string> = {
  referrer: "Referente",
  operator: "Prestador",
};

const STATUS_LABELS: Record<string, string> = {
  onboarding: "En preparación",
  pending_review: "En revisión",
  active: "Activo",
  suspended: "Suspendido",
};

const STATUS_CHIP_COLOR: Record<string, "default" | "success" | "warning" | "danger"> = {
  onboarding: "default",
  pending_review: "warning",
  active: "success",
  suspended: "danger",
};

type CapabilityRow = {
  id: string;
  role: string;
  status: string;
  establishment_id: string | null;
};

// Feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.1) : premier
// atterrissage réel après une invitation — jusqu'ici JoinForm affichait un message inline sans
// jamais rediriger, et /partner n'avait aucune page.tsx. Le statut affiché ici est toujours
// recalculé à la volée (pas un message éphémère transmis depuis JoinForm) : robuste à un refresh,
// reflète l'état réel même si le partenaire revient sur cette page des jours plus tard.
export default async function PartnerHomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner");
  }

  // partner_id_for_account (même RPC que commissions/products/tools) — pas une jointure manuelle.
  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  const { data: capabilities } = partnerId
    ? await supabase
        .from("partner_capabilities")
        .select("id, role, status, establishment_id")
        .eq("partner_id", partnerId)
        .order("role")
    : { data: null };

  const rows = (capabilities ?? []) as CapabilityRow[];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Inicio</h1>

      <Card data-testid="partner-status-card">
        <Card.Header>
          <Card.Title>Tus roles</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Aún no tienes ningún rol asignado.</p>
          ) : (
            rows.map((capability) => (
              <div
                key={capability.id}
                data-testid={`partner-role-${capability.role}`}
                className="flex flex-col gap-1 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {ROLE_LABELS[capability.role] ?? capability.role}
                  </span>
                  <Chip
                    variant="soft"
                    color={STATUS_CHIP_COLOR[capability.status] ?? "default"}
                  >
                    {STATUS_LABELS[capability.status] ?? capability.status}
                  </Chip>
                </div>
                {capability.role === "operator" && capability.establishment_id === null ? (
                  <p className="text-sm text-muted" data-testid="partner-establishment-pending">
                    Aún no tienes un establecimiento vinculado.{" "}
                    <Link href="/partner/establishment/new" className="underline">
                      Proponer un establecimiento
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            ))
          )}
        </Card.Content>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <Card.Content>
            <a href="/partner/commissions" className="text-sm font-medium hover:underline">
              Mis comisiones →
            </a>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <a href="/partner/products" className="text-sm font-medium hover:underline">
              Mis actividades →
            </a>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content>
            <a href="/partner/tools" className="text-sm font-medium hover:underline">
              Mi enlace y QR →
            </a>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
