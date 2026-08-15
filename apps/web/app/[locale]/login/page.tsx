import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/login">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "Login" });
  return { title: t("title") };
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
