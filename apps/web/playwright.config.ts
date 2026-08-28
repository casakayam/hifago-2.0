import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    // Port 3100, pas 3000 : le 3000 local est occupé en permanence par un conteneur Docker
    // d'un autre projet sur cette machine (décision Jérôme, 2026-08-13) — cf. package.json
    // (`next dev -p 3100`) et supabase/config.toml (site_url/additional_redirect_urls alignés).
    baseURL: "http://localhost:3100",
    // Lot fuseau (2026-08-28). Le navigateur des tests est à GUATAPÉ, comme les visiteurs et les
    // socios réels. Sans ce réglage, les calendriers client (react-day-picker, SVAR) prennent le
    // fuseau de la machine du runner — America/Bogota sur la machine de dev, UTC en CI — et la
    // suite mesure alors la machine plutôt que l'application. C'est cette divergence-là qui a
    // rendu les dix sites du fuseau invisibles pendant des mois.
    //
    // ⚠️ Ne couvre QUE le navigateur. Le processus Node du runner (les helpers de
    // packages/e2e-support) et le serveur Next gardent leur propre fuseau : eux passent par
    // todayInBogota(), et les deux gestes sont nécessaires.
    timezoneId: "America/Bogota",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
  },
});
