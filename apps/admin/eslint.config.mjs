import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    rules: {
      // HeroUI v3 = seul socle de composants, importé uniquement via @hifago/ui (packages/ui) —
      // jamais @heroui/react directement dans une app (hifago/CLAUDE.md § 2). Rend cette règle
      // vérifiée en continu plutôt que documentée seule.
      "no-restricted-imports": ["error", { paths: [{ name: "@heroui/react", message: "Importer depuis \"@hifago/ui\", pas directement depuis \"@heroui/react\"." }] }],
    },
  },
]);

export default eslintConfig;
