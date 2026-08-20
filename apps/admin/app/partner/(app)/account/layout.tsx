import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/account, même patron que partner/commissions/layout.tsx : redondante
// avec la garde du groupe (app) parent (volontaire, cf. son commentaire), évite seulement
// d'afficher un écran vide à un visiteur non authentifié.
export default async function PartnerAccountLayout({ children }: LayoutProps<"/partner/account">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/account");
  }

  return children;
}
