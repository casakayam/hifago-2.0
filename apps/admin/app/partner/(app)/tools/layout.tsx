import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/tools — même patron que partner/products/layout.tsx et
// partner/commissions/layout.tsx (garde serveur, jamais un simple masquage client) : ici la vraie
// barrière est partner_codes_select_public (déjà `using (true)`, lecture publique) filtrée par
// partenaire côté requête (page.tsx) ; cette garde évite seulement d'afficher un écran vide à un
// visiteur non authentifié.
//
// docs/specs/10-listes-standardisees-admin-socio.md §5.5 — le wrapper de largeur retiré ici était
// déjà redondant (même max-w-3xl que le layout parent) : la largeur et le padding viennent
// désormais uniquement du layout parent (partner/(app)/layout.tsx).
export default async function PartnerToolsLayout({ children }: LayoutProps<"/partner/tools">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/tools");
  }

  return children;
}
