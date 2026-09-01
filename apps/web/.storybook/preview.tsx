import type { Preview } from "@storybook/nextjs-vite";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { NextIntlClientProvider } from "next-intl";

import "../app/globals.css";
import { loadMessages, type Locale } from "../messages";
import { routing } from "../i18n/routing";

// ⚠️ Les polices Geist ne sont VOLONTAIREMENT pas appliquées ici, et ce n'est pas un oubli :
// elles ne le sont pas non plus en production. `app/[locale]/layout.tsx` définit
// `--font-geist-sans`/`--font-geist-mono`, mais HeroUI et Tailwind v4 consomment `--font-sans` et
// `--font-mono` — des noms différents, que rien ne relie. La vitrine tourne donc sur la pile de
// polices système. Les appliquer ici ferait mentir le playground sur ce que voit un visiteur.
// Constaté le 2026-09-01 en montant ce playground ; signalé, non corrigé (hors périmètre).

const LIBELLES_LOCALE: Record<Locale, string> = { es: "Español", en: "English" };

const preview: Preview = {
  parameters: {
    // Trois gabarits repris de l'existant plutôt qu'inventés. ⚠️ Source exacte, parce que je
    // l'avais d'abord mal attribuée : 390×844 et 1280×900 viennent de
    // `.claude/skills/hifago-ui/SKILL.md` (« les mêmes deux viewports que le legacy testait ») —
    // et NON des tests e2e, dont la config Playwright utilise `devices["Desktop Chrome"]`, soit
    // 1280×720. 768 est le point de bascule `md` de Tailwind.
    viewport: {
      options: {
        mobile: { name: "Mobile 390", styles: { width: "390px", height: "844px" } },
        tablette: { name: "Tablette 768", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop 1280", styles: { width: "1280px", height: "900px" } },
      },
    },
  },
  // Mobile par défaut : c'est la façon la plus simple d'imposer le « mobile d'abord » dans les
  // faits — on réserve une activité à Guatapé depuis un téléphone, et Google indexe le mobile.
  initialGlobals: {
    viewport: { value: "mobile", isRotated: false },
    locale: routing.defaultLocale,
  },
  globalTypes: {
    locale: {
      description: "Langue de l'interface",
      toolbar: {
        icon: "globe",
        // Dérivé de `routing.locales` : une troisième locale ajoutée dans i18n/routing.ts
        // apparaîtra ici toute seule. Écrite à la main, elle aurait manqué en silence — seuls les
        // libellés restent codés, ils n'ont pas d'autre source.
        items: routing.locales.map((valeur) => ({ value: valeur, title: LIBELLES_LOCALE[valeur] })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Sans ce provider, tout composant appelant useTranslations plante. Même pattern que les six
    // tests de composants du dépôt. Le sélecteur de langue n'est pas un gadget : l'espagnol est
    // 20 à 25 % plus long que l'anglais, et c'est lui qui fait déborder boutons et titres.
    (Story, context) => {
      const locale = (context.globals.locale as Locale) ?? routing.defaultLocale;
      return (
        <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
          <Story />
        </NextIntlClientProvider>
      );
    },
    // Le thème est posé sur <html> en production par le layout ; ici c'est cet addon qui le pose.
    // ⚠️ Le thème `vitrine` ne définit AUCUN token (le thème `admin` en définit ~37) : pouvoir
    // basculer entre les deux montre exactement ce que la vitrine n'a pas.
    withThemeByDataAttribute({
      themes: { vitrine: "vitrine", admin: "admin" },
      defaultTheme: "vitrine",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
