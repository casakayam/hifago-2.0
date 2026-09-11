import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { ProfileForm } from "./ProfileForm";

// Ce que ce fichier existe pour tenir : le bouton reste désactivé tant que rien n'a changé (sinon
// un clic accidentel réécrirait le profil avec les mêmes valeurs, un aller-retour réseau inutile
// sur un formulaire qui n'a pourtant rien à sauver) ; et le téléphone vide part comme `undefined`,
// jamais `""` — c'est `update_my_account_profile` qui distingue les deux (`nullif` sur une chaîne
// vide), pas ce composant, mais un `""` envoyé au lieu d'`undefined` reste vrai en pratique donc
// invisible à l'écran — seule une assertion sur l'appel le prouve.

let dernierAppelRpc: { nom: string; args: unknown } | null = null;

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: (nom: string, args: unknown) => {
      dernierAppelRpc = { nom, args };
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

function rendre(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <ProfileForm initialFullName="Cliente Real" initialPhone="+573001112233" />
    </NextIntlClientProvider>
  );
  return container;
}

describe("ProfileForm", () => {
  beforeEach(() => {
    dernierAppelRpc = null;
  });

  it("le bouton reste désactivé tant que rien n'a changé", () => {
    const container = rendre();
    const bouton = container.querySelector('[data-testid="profile-save-button"]') as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
  });

  it("s'active dès que le nom change, et appelle update_my_account_profile avec les valeurs modifiées", async () => {
    const container = rendre();
    const champNom = container.querySelector('[data-testid="profile-full-name-input"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(champNom, { target: { value: "Cliente Editado" } });
    });
    const bouton = container.querySelector('[data-testid="profile-save-button"]') as HTMLButtonElement;
    expect(bouton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(bouton);
    });

    expect(dernierAppelRpc).toEqual({
      nom: "update_my_account_profile",
      args: { p_full_name: "Cliente Editado", p_phone: "+573001112233" },
    });
  });

  it("un téléphone vidé part comme undefined, jamais comme une chaîne vide", async () => {
    const container = rendre();
    const champTelephone = container.querySelector(
      '[data-testid="profile-phone-input"]'
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(champTelephone, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="profile-save-button"]') as HTMLButtonElement);
    });

    expect((dernierAppelRpc?.args as { p_phone: unknown })?.p_phone).toBeUndefined();
  });
});
