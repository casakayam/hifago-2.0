import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/tools — même patron que partner/products/layout.tsx et
// partner/commissions/layout.tsx (garde serveur, jamais un simple masquage client) : ici la vraie
// barrière est partner_codes_select_public (déjà `using (true)`, lecture publique) filtrée par
// partenaire côté requête (page.tsx) ; cette garde évite seulement d'afficher un écran vide à un
// visiteur non authentifié.
export default async function PartnerToolsLayout({ children }: LayoutProps<"/partner/tools">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/tools");
  }

  return <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">{children}</div>;
}
