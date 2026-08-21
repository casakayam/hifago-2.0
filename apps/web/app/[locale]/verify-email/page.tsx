import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ResendConfirmationForm } from "./ResendConfirmationForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/verify-email">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "VerifyEmail" });
  return { title: t("title") };
}

// Atterrissage après un signUp() sans session (confirmation requise) — même besoin que l'écran
// homologue d'apps/admin (encore vivant), adapté et localisé pour apps/web. `email` optionnel :
// arrivée directe sans contexte affiche un message générique plutôt que de planter.
export default async function VerifyEmailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/verify-email">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("VerifyEmail");

  const resolvedSearchParams = await searchParams;
  const emailParam = resolvedSearchParams?.email;
  const email = typeof emailParam === "string" ? emailParam : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted">
        {email ? t("bodyWithEmail", { email }) : t("bodyGeneric")}
      </p>
      <ResendConfirmationForm email={email} />
    </main>
  );
}
