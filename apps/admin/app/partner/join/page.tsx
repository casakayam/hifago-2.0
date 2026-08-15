import { JoinForm } from "./JoinForm";

// Premier écran du portail socio (/partner) dans tout le projet. Cette app n'est pas localisée (cf.
// hifago/CLAUDE.md — i18n/next-intl ne vise qu'apps/web) : tout le texte de cet écran, y compris
// les messages d'erreur de JoinForm, est en français en dur, assumé.
export default async function PartnerJoinPage({
  searchParams,
}: PageProps<"/partner/join">) {
  const resolvedSearchParams = await searchParams;
  const tokenParam = resolvedSearchParams?.token;
  const token = typeof tokenParam === "string" ? tokenParam : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Rejoindre Hifago</h1>
      <JoinForm token={token} />
    </main>
  );
}
