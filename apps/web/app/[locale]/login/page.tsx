import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/login">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "Login" });
  // ⚠️ noindex plutôt qu'un Disallow dans robots.txt, et la distinction n'est pas cosmétique :
  // une page en Disallow n'est jamais CHARGÉE, donc sa balise noindex n'est jamais lue, et elle
  // peut finir indexée sans description si un lien externe la désigne. Disallow sert à économiser
  // du budget de crawl, noindex à empêcher l'indexation — jamais les deux sur la même page
  // (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Login");

  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LoginForm next={next} />
    </main>
  );
}
