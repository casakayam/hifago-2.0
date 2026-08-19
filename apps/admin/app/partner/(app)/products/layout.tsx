import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { requirePartnerOrAdmin } from "@/lib/partnerGuard";

// Garde scopée à /partner/products (et ses enfants /new, /[id]/edit) — jamais au segment /partner
// en entier, qui contient aussi /partner/join, volontairement accessible à un visiteur non
// connecté (feature 13). Même patron que admin/layout.tsx (garde serveur, jamais un simple
// masquage client), sans le contrôle is_admin() : ici, la RLS (products_select_own,
// product_proposals_select_own) et le contrôle de capacité interne à submit_product_proposal/
// submit_product_creation_proposal restent la vraie barrière ; cette garde ne fait qu'éviter
// d'afficher un écran vide à un visiteur non authentifié.
//
// docs/specs/10-listes-standardisees-admin-socio.md §5.5 — le wrapper de largeur retiré ici était
// déjà mort (max-w-4xl imbriqué dans le max-w-3xl du layout parent, sans effet réel) : la largeur
// et le padding viennent désormais uniquement du layout parent (partner/(app)/layout.tsx).
//
// Garde partner_id ajoutée (spec 15, même correctif que establishment/layout.tsx le 2026-08-17) :
// un compte issu de l'inscription libre sans partner_id pouvait jusqu'ici atteindre
// /partner/products/new (nouveau) sans explication, bloqué seulement à la soumission par
// submit_product_creation_proposal. is_admin() aussi autorisé — un admin n'a jamais de partner_id
// (capacité portée par le compte lui-même), même raison que la garde établissement.
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

  await requirePartnerOrAdmin(supabase, user.id);

  return children;
}
