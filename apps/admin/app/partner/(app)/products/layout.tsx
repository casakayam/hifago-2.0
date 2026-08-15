import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/products (et ses enfants /[id]/edit) — jamais au segment /partner en
// entier, qui contient aussi /partner/join, volontairement accessible à un visiteur non connecté
// (feature 13). Même patron que admin/layout.tsx (garde serveur, jamais un simple masquage
// client), sans le contrôle is_admin() : ici, la RLS (products_select_own,
// product_proposals_select_own) et le contrôle de capacité interne à submit_product_proposal
// restent la vraie barrière ; cette garde ne fait qu'éviter d'afficher un écran vide à un visiteur
// non authentifié.
export default async function PartnerProductsLayout({
  children,
}: LayoutProps<"/partner/products">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/products");
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">{children}</div>;
}
