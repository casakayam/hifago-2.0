import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

// Même convention que /login (espagnol en dur, pas de rôle vérifié ici) — inscription libre
// générique (docs/specs/07-connexion-inscription-complete.md §5), distincte de /partner/join
// (invitation, capacités accordées automatiquement) : ici, aucune capacité n'est créée, un compte
// nu (implicitement « client ») comme n'importe quel compte Supabase Auth via cet écran.
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Crear cuenta</h1>
      <SignupForm next={next} />
    </main>
  );
}
