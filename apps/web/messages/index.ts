// Messages d'interface, UN FICHIER PAR NAMESPACE ET PAR LOCALE.
//
// ⚠️ Pourquoi éclaté plutôt qu'un `es.json` unique (2026-09-01) : plusieurs agents créent des
// composants EN PARALLÈLE dans le même répertoire de travail. Il n'y a donc aucun merge git pour
// arbitrer — deux agents qui écrivent dans le même fichier de messages s'écrasent en direct, sans
// que rien ne le signale. Un fichier par namespace supprime la course : chacun n'écrit que dans le
// sien.
//
// Les imports ci-dessous sont STATIQUES à dessein : `import.meta.glob` ne fonctionne que sous Vite
// (donc Storybook), et une lecture du système de fichiers ne fonctionne pas côté client ni en test.
// Seuls des imports statiques marchent dans les trois environnements — Next (serveur), Vitest et
// Vite. Ce fichier n'est modifié qu'à l'ajout d'un NAMESPACE (rare : un par écran), jamais à
// l'ajout d'une clé — c'est ce qui le rend acceptable comme point de passage partagé.
import esLocaleLayout from "./es/LocaleLayout.json";
import esHomePage from "./es/HomePage.json";
import esLogin from "./es/Login.json";
import esSignup from "./es/Signup.json";
import esVerifyEmail from "./es/VerifyEmail.json";
import esCommon from "./es/Common.json";
import esProductPage from "./es/ProductPage.json";
import esEstablishmentPage from "./es/EstablishmentPage.json";
import esCheckoutPage from "./es/CheckoutPage.json";
import esAccountOrdersPage from "./es/AccountOrdersPage.json";
import enLocaleLayout from "./en/LocaleLayout.json";
import enHomePage from "./en/HomePage.json";
import enLogin from "./en/Login.json";
import enSignup from "./en/Signup.json";
import enVerifyEmail from "./en/VerifyEmail.json";
import enCommon from "./en/Common.json";
import enProductPage from "./en/ProductPage.json";
import enEstablishmentPage from "./en/EstablishmentPage.json";
import enCheckoutPage from "./en/CheckoutPage.json";
import enAccountOrdersPage from "./en/AccountOrdersPage.json";

import type { routing } from "@/i18n/routing";

/** Locale d'interface routée. Exportée pour que personne n'ait à re-dériver la même chaîne. */
export type Locale = (typeof routing)["locales"][number];

const MESSAGES = {
  es: {
    LocaleLayout: esLocaleLayout,
    HomePage: esHomePage,
    Login: esLogin,
    Signup: esSignup,
    VerifyEmail: esVerifyEmail,
    Common: esCommon,
    ProductPage: esProductPage,
    EstablishmentPage: esEstablishmentPage,
    CheckoutPage: esCheckoutPage,
    AccountOrdersPage: esAccountOrdersPage,
  },
  en: {
    LocaleLayout: enLocaleLayout,
    HomePage: enHomePage,
    Login: enLogin,
    Signup: enSignup,
    VerifyEmail: enVerifyEmail,
    Common: enCommon,
    ProductPage: enProductPage,
    EstablishmentPage: enEstablishmentPage,
    CheckoutPage: enCheckoutPage,
    AccountOrdersPage: enAccountOrdersPage,
  },
} as const;

/** Messages complets d'une locale. Utilisé par i18n/request.ts, les tests et le playground. */
export function loadMessages(locale: Locale) {
  return MESSAGES[locale];
}

