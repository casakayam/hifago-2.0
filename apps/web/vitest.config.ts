import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // jsdom : requis pour tout test composant (render() + @testing-library/react) — absent
    // jusqu'ici (aucun *.test.tsx n'existait encore dans le monorepo, découvert spec 11).
    environment: "jsdom",
    // e2e/**/*.spec.ts sont des specs Playwright (autre test runner) — le glob par défaut de
    // Vitest les ramasse sinon et casse sur `test()` de @playwright/test.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
