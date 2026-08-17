"use client";

import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";
import { ChartCard } from "@hifago/ui";

// Ordre = catalogHealth dans page.tsx : [Publicado, Borrador, En revisión, Rechazado].
// --accent réservé aux actions/CTA (pas une couleur de donnée parmi d'autres) — retiré d'ici.
// #6366f1 (indigo) supprimé : seule couleur froide de tout le thème admin, aucun rapport avec
// la palette chaude par ailleurs.
const COLORS = ["var(--success)", "var(--default)", "var(--warning)", "var(--danger)"];

export function CatalogHealthChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ChartCard title="Salud del catálogo" testId="chart-catalog-health">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} label>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip />
      </PieChart>
    </ChartCard>
  );
}
