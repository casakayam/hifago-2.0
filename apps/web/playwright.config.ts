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
