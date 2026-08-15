import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/commissions, même patron que partner/products/layout.tsx : la vraie
// barrière est la RLS (order_lines_select_referrer, feature 14), cette garde évite seulement
// d'afficher un écran vide à un visiteur non authentifié.
export default async function PartnerCommissionsLayout({
  children,
}: LayoutProps<"/partner/commissions">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/commissions");
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">{children}</div>;
}
