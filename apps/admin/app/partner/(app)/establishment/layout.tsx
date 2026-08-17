import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/establishment (et ses enfants /new, /[id]/edit) — même patron que
// products/layout.tsx : la vraie barrière reste la RLS (establishments_select) et les garde-fous
// internes aux RPC submit_establishment_*_proposal (ownership, capacité), cette garde évite
// seulement d'afficher un écran vide à un visiteur non authentifié.
//
// docs/specs/10-listes-standardisees-admin-socio.md §5.5 — le wrapper de largeur retiré ici était
// déjà mort (max-w-4xl imbriqué dans le max-w-3xl du layout parent, sans effet réel) : la largeur
// et le padding viennent désormais uniquement du layout parent (partner/(app)/layout.tsx).
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

  return children;
}
