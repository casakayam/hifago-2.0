import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/establishment (et ses enfants /new, /[id]/edit) — même patron que
// products/layout.tsx : la vraie barrière reste la RLS (establishments_select) et les garde-fous
// internes aux RPC submit_establishment_*_proposal (ownership, capacité), cette garde évite
// seulement d'afficher un écran vide à un visiteur non authentifié.
export default async function PartnerEstablishmentLayout({
  children,
}: LayoutProps<"/partner/establishment">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/establishment");
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">{children}</div>;
}
