"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { Card } from "@heroui/react";

/**
 * Wrapper de graphique Recharts pour la page d'accueil admin
 * (docs/specs/02-admin-accueil-et-navigation.md §5.2) — première vraie utilisation de Recharts
 * dans le repo (dépendance déjà déclarée côté admin, jamais consommée jusqu'ici). `"use client"`
 * obligatoire : `ResponsiveContainer` s'appuie sur `ResizeObserver`, une API navigateur.
 * `children` est le graphique Recharts lui-même (`<LineChart>`, `<BarChart>`...), pas construit
 * ici — ce composant ne fait que le cadrage (titre, carte, hauteur responsive).
 */
export type ChartCardProps = {
  title: string;
  height?: number;
  children: React.ReactElement;
  testId?: string;
};

export function ChartCard({ title, height = 280, children, testId }: ChartCardProps) {
  return (
    <Card data-testid={testId}>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      </Card.Content>
    </Card>
  );
}
