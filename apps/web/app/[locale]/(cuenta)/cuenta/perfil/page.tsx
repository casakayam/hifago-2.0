import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getMyProfile } from "@/lib/account/getMyProfile";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { LinkButton } from "@/components/atoms/LinkButton";
import { ProfileForm } from "./ProfileForm";
import { LogoutButton } from "./LogoutButton";
import { DeleteAccountSection } from "./DeleteAccountSection";

// « MI PERFIL » — l'accueil de la zone compte (spec 35 décision ⑧). Le layout (`(cuenta)/layout.tsx`)
// a déjà refusé un invité/visiteur AVANT ce fichier — `getMyProfile()` revérifie quand même
// (`getViewerAccount` en son cœur), même discipline que `/cuenta/reservas` : « jamais par la seule
// garde d'écran ».

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountProfilePage");
  // Pas de `robots` ici : la zone entière est déjà `index: false` par son layout.
  return { title: t("metaTitle") };
}

export default async function AccountProfilePage({
  params,
}: PageProps<"/[locale]/cuenta/perfil">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AccountProfilePage");

  const profile = await getMyProfile();
  if (!profile) {
    redirect({ href: "/entrar?next=/cuenta/perfil", locale });
    return;
  }

  return (
    <PageShell variant="narrow" testId="mi-perfil-page">
      <Title as="h1">{t("title")}</Title>

      <ProfileForm initialFullName={profile.fullName} initialPhone={profile.phone} />

      <LinkButton href="/cuenta/reservas" variant="outline" color="neutral" width="auto">
        {t("myOrdersCta")}
      </LinkButton>

      <LogoutButton />

      <DeleteAccountSection
        email={profile.email}
        hasProfessionalCapability={profile.hasProfessionalCapability}
      />
    </PageShell>
  );
}
