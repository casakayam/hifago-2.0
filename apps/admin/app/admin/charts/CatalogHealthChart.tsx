"use client";

import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";
import { ChartCard } from "@hifago/ui";

const COLORS = ["var(--accent)", "#f59e0b", "#6366f1", "#ef4444"];

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
