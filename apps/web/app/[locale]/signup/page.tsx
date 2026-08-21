import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { SignupForm } from "./SignupForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/signup">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "Signup" });
  return { title: t("title") };
}

// Inscription libre générique (docs/01-cahier-des-charges-client.md §2, feature 32) — aucune
// capacité créée ici, un compte nu comme n'importe quel compte Supabase Auth via cet écran
// (même principe que l'ancien /signup admin, cf. SignupForm.tsx). Pas de rôle vérifié.
export default async function SignupPage({
  params,
  searchParams,
}: PageProps<"/[locale]/signup">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Signup");

  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <SignupForm next={next} />
    </main>
  );
}
