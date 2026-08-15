import { cookies } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { CheckoutForm } from "./CheckoutForm";

export default async function CheckoutPage({
  params,
}: PageProps<"/[locale]/checkout">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CheckoutPage");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Feature 7 (attribution) : lu côté serveur depuis le cookie de session posé par proxy.ts
  // (?ref=<code>), jamais depuis une saisie utilisateur — aucun champ de code visible nulle part
  // dans l'interface.
  const cookieStore = await cookies();
  const attributionCode = cookieStore.get("hifago_ref")?.value;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CheckoutForm isAuthenticated={Boolean(user)} attributionCode={attributionCode} />
    </main>
  );
}
