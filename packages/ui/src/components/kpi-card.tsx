import * as React from "react";
import { Card } from "@heroui/react";

/**
 * Carte KPI de la page d'accueil admin (docs/specs/02-admin-accueil-et-navigation.md §5.2) —
 * reprend la forme des 3 chiffres du dashboard legacy (`public/admin.js:208-234`), sur le socle
 * HeroUI plutôt qu'en HTML/CSS ad hoc.
 */
export type KpiCardProps = {
  label: string;
  value: string;
  sublabel?: React.ReactNode;
  testId?: string;
};

export function KpiCard({ label, value, sublabel, testId }: KpiCardProps) {
  return (
    <Card data-testid={testId}>
      <Card.Content className="flex flex-col gap-1 p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
        {sublabel ? <span className="text-xs text-muted">{sublabel}</span> : null}
      </Card.Content>
    </Card>
  );
}
