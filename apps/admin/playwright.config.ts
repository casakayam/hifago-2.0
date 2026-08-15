import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    // Port 3101 (apps/admin) — cf. package.json (`next dev -p 3101`) et supabase/config.toml
    // (additional_redirect_urls aligné le 2026-08-14 lors de la scission monorepo web/admin).
    baseURL: "http://localhost:3101",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Deux serveurs : plusieurs specs (offboarding, publish/dépublish, disponibilité socio, lien
  // de parrainage...) vérifient l'effet d'une action admin/socio sur la fiche publique, qui vit
  // désormais dans apps/web (port 3100) — un autre process, depuis la scission monorepo web/admin
  // du 2026-08-14. Sans ce second webServer, ces specs échouent en ERR_CONNECTION_REFUSED.
  webServer: [
    {
      command: "npm run dev",
      // "/" existe (app/page.tsx, dispatcher par type d'utilisateur) mais exige une session et
      // redirige donc vers /login pour un visiteur anonyme — pointer la vérification de
      // disponibilité du serveur directement sur /login, qui répond toujours 200 sans dépendre
      // d'un aller-retour Supabase.
      url: "http://localhost:3101/login",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --workspace=apps/web",
      cwd: "../..",
      url: "http://localhost:3100/es",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
