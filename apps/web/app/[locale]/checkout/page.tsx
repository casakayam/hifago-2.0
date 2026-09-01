import type { Metadata } from "next";
import { cookies } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { CheckoutForm } from "./CheckoutForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/checkout">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "CheckoutPage" });
  // Un panier n'a rien d'indexable, et son contenu est propre à une session. noindex plutôt que
  // Disallow, pour la raison expliquée sur les écrans d'authentification (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

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

  // Feature 32 — pré-remplissage pour un client connecté (cahier des charges client §2 point 6) :
  // l'email vient toujours du compte auth (garanti dès l'inscription email/mot de passe), nom/
  // téléphone viennent de la commande la plus récente du compte s'il en existe une (aucune table
  // profil séparée). RLS déjà scopée à account_id = auth.uid() (même garde que /account/orders) —
  // un champ pré-rempli reste éditable, jamais un verrou (CheckoutForm.tsx).
  let initialHolderName = "";
  let initialHolderPhone = "";
  const initialHolderEmail = user?.email ?? "";
  if (user) {
    const { data: lastOrder } = await supabase
      .from("orders")
      .select("holder_name, holder_phone")
      .eq("account_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    initialHolderName = lastOrder?.holder_name ?? "";
    initialHolderPhone = lastOrder?.holder_phone ?? "";
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CheckoutForm
        isAuthenticated={Boolean(user)}
        attributionCode={attributionCode}
        initialHolderName={initialHolderName}
        initialHolderPhone={initialHolderPhone}
        initialHolderEmail={initialHolderEmail}
      />
    </main>
  );
}
