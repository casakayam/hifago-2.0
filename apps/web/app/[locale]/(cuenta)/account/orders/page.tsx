import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { OrdersList } from "./OrdersList";

// Feature 8 : minimal (pas la « page compte » complète du cahier des charges), juste ce qu'il faut
// pour rendre l'annulation testable — liste des commandes du compte connecté (RLS orders_select
// déjà en place depuis la Tranche 3), pas de vue détaillée ligne par ligne.
export default async function AccountOrdersPage({
  params,
}: PageProps<"/[locale]/account/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AccountOrdersPage");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/login?next=/account/orders", locale });
  }

  // order_lines(id, status) : orders_select/order_lines_select (Tranche 3) filtrent déjà sur
  // account_id = auth.uid() — un invité (account_id null) n'a jamais accès à cet écran (redirigé
  // ci-dessus faute de session), donc jamais de risque de fuite d'une commande invité ici.
  const { data: orders } = await supabase
    .from("orders")
    .select("id, holder_name, created_at, order_lines(id, status)")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <OrdersList orders={orders ?? []} />
    </main>
  );
}
