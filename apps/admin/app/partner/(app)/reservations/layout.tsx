import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { requirePartnerOrAdmin } from "@/lib/partnerGuard";
import { getOperatorCapability } from "@/lib/agenda/activeOperatorEstablishments";

// Garde scopée à /partner/reservations — même patron que products/layout.tsx (spec 15) et
// establishment/layout.tsx : garde serveur, jamais un simple masquage client. La vraie barrière de
// données est la RLS (order_lines_select_operator, spec 17 §0 Tranche 1) ; cette garde évite
// seulement d'afficher un écran vide à un visiteur non authentifié ou sans capacité d'aucune sorte.
export default async function PartnerReservationsLayout({
  children,
}: LayoutProps<"/partner/reservations">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/reservations");
  }

  const { partnerId, isAdmin } = await requirePartnerOrAdmin(supabase, user.id);

  // Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md) — même garde
  // qu'establishment/layout.tsx : un référent pur n'a rien à faire ici, ses ventes attribuées
  // vivent sur /partner/commissions.
  if (!isAdmin && !(await getOperatorCapability(supabase, partnerId))) {
    redirect("/partner");
  }

  return children;
}
