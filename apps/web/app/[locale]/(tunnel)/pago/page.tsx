import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";
import { getCartLines } from "@/lib/cart/getCartLines";
import { CartSummary } from "@/components/organisms/CartSummary";
import { CheckoutForm } from "./CheckoutForm";
import type { Locale } from "@/messages";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/pago">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "CheckoutPage" });
  // Un panier n'a rien d'indexable, et son contenu est propre à une session. noindex plutôt que
  // Disallow, pour la raison expliquée sur les écrans d'authentification (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function CheckoutPage({
  params,
}: PageProps<"/[locale]/pago">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CheckoutPage");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Spec 32 (panier en base) : l'attribution est désormais capturée dans carts.attribution_code
  // dès le premier ajout au panier (CartContext, via /api/cart/attribution) — create_order la lit
  // lui-même côté serveur, plus besoin de relire le cookie hifago_ref ici pour la lui transmettre.
  const lines = await getCartLines(locale as Locale);

  // Feature 32 — pré-remplissage pour un client connecté (cahier des charges client §2 point 6) :
  // l'email vient toujours du compte auth (garanti dès l'inscription email/mot de passe), nom/
  // téléphone viennent de la commande la plus récente du compte s'il en existe une (aucune table
  // profil séparée). RLS déjà scopée à account_id = auth.uid() (même garde que /cuenta/reservas) —
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
      <CartSummary lines={lines} editable={false} locale={locale as Locale} />
      {lines.length > 0 ? (
        <CheckoutForm
          // ⚠️ Spec 33 — `isRealAccount`, jamais `Boolean(user)` seul. Depuis la spec 31 un invité
          // A une identité : le calcul d'origine masquait le lien « Iniciar sesión » du formulaire
          // (le seul du tunnel) à tous ceux qui en avaient justement besoin.
          isAuthenticated={isRealAccount(user)}
          initialHolderName={initialHolderName}
          initialHolderPhone={initialHolderPhone}
          initialHolderEmail={initialHolderEmail}
        />
      ) : null}
    </main>
  );
}
