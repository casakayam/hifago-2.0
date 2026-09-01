import type { StorybookConfig } from "@storybook/nextjs-vite";

// Playground des composants de la vitrine. Décision de Jérôme du 2026-09-01 : Storybook plutôt
// qu'une route interne — elle clôt le point laissé ouvert par apps/test-ux/README.md
// (« Storybook ou preview interne, décision séparée »).
//
// ⚠️ Les stories sont découvertes par GLOB, sans registre central. C'est délibéré : plusieurs
// agents créent des composants en parallèle dans le même répertoire de travail, et un registre
// serait le fichier que tous éditeraient en même temps. Ajouter un composant au playground ne
// demande donc de modifier AUCUN fichier partagé.
const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(ts|tsx)",
    // Les composants d'écran vivent encore dans app/[locale]/… ; leurs tests y sont déjà
    // colocalisés, leurs stories le sont donc aussi.
    "../app/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-themes", "@storybook/addon-a11y"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
};

export default config;
