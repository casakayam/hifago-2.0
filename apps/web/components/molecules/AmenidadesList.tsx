import type { AmenidadPorCategoria } from "@/lib/catalog/tipos";

// Présentation pure — reçoit des chaînes déjà résolues dans la locale, ne traduit rien elle-même
// (`.claude/rules/apps.md`). Liste à puces classique par catégorie, PAS des chips/labels : chaque
// catégorie son `<h3>` suivi de sa `<ul>`, verticale — décision explicite de Jérôme (2026-09-17),
// pas un `flex-wrap` de pastilles.
export function AmenidadesList({
  grupos,
  testId,
}: {
  grupos: AmenidadPorCategoria[];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {grupos.map((grupo) => (
        <div key={grupo.categoria} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{grupo.categoria}</h3>
          <ul className="list-disc pl-5 text-sm text-muted">
            {grupo.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
