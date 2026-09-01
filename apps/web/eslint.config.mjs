import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import storybook from "eslint-plugin-storybook";
import { reglesFuseau } from "../../eslint.rules.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "storybook-static/**"]),
  // Règles propres aux stories (export default obligatoire, titres cohérents, pas de
  // `play` mal formé…). Utile surtout parce que plusieurs agents vont écrire des stories en
  // parallèle : autant que l'outil arbitre plutôt qu'une relecture.
  ...storybook.configs["flat/recommended"],
  {
    rules: {
      // HeroUI v3 = seul socle de composants, importé uniquement via @hifago/ui (packages/ui) —
      // jamais @heroui/react directement dans une app (hifago/CLAUDE.md § 2). Rend cette règle
      // vérifiée en continu plutôt que documentée seule.
      "no-restricted-imports": ["error", { paths: [{ name: "@heroui/react", message: "Importer depuis \"@hifago/ui\", pas directement depuis \"@heroui/react\"." }] }],
      // Fuseau de l'exploitation — cf. eslint.rules.mjs (lot du 2026-08-28).
      ...reglesFuseau,
    },
  },
]);

export default eslintConfig;
