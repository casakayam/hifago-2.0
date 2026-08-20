import Link from "next/link";
import { buttonVariants } from "@hifago/ui";

// Remplace le texte discret précédent ("Aún no tienes ningún establecimiento rattachado." /
// "Ninguna actividad todavía.") par un vrai bloc CTA visible — demande explicite de Jérôme (refonte
// vue prestataire, 2026-08-19) pour l'état vide de l'établissement et des activités.
export function EmptyStateCta({
  title,
  description,
  actionHref,
  actionLabel,
  testId,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface-secondary/40 px-6 py-12 text-center"
      data-testid={testId}
    >
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted">{description}</p>
      <Link href={actionHref} className={buttonVariants({ size: "sm" })} data-testid={`${testId}-action`}>
        {actionLabel}
      </Link>
    </div>
  );
}
