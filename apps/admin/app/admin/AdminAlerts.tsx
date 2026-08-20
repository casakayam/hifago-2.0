import { Card } from "@hifago/ui";

// Alertas en lectura, cargadas solo al renderizar la página (sin polling/Realtime, spec §10) —
// cahier des charges admin §2 "notifications proactives".
//
// "Capacidades de prestador en revisión" retirada (2026-08-20, migration
// 20260820010000_partner_capabilities_active_by_default.sql) : partner_capabilities.status ne
// vaut plus jamais 'pending_review' (toute capacité démarre 'active'), cette alerte n'aurait plus
// jamais eu de raison de s'afficher.
export type AdminAlertsProps = {
  proposalsPending: number;
  reconciliationOpen: number;
};

function AlertRow({ count, label, href, testId }: { count: number; label: string; href: string; testId: string }) {
  if (count === 0) return null;
  return (
    <a
      href={href}
      data-testid={testId}
      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-secondary"
    >
      <span>{label}</span>
      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">{count}</span>
    </a>
  );
}

export function AdminAlerts({ proposalsPending, reconciliationOpen }: AdminAlertsProps) {
  const hasAny = proposalsPending > 0 || reconciliationOpen > 0;
  if (!hasAny) return null;

  return (
    <Card data-testid="admin-alerts">
      <Card.Header>
        <Card.Title>Pendientes</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-1">
        <AlertRow
          count={proposalsPending}
          label="Propuestas por moderar"
          href="/admin/proposals"
          testId="alert-proposals"
        />
        <AlertRow
          count={reconciliationOpen}
          label="Excepciones de reconciliación"
          href="/admin/reconciliation"
          testId="alert-reconciliation"
        />
      </Card.Content>
    </Card>
  );
}
