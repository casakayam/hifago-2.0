import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le monorepo hifago/ (deux niveaux au-dessus de cette app) a son propre package-lock.json,
  // distinct de celui de l'app legacy à la racine du dépôt — sans ceci Turbopack remonte par
  // erreur à la racine du dépôt comme workspace root.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // Packages "source" du monorepo (pas de dist/ pré-buildé) — transpilePackages fait que
  // Next.js les transpile comme du code applicatif.
  transpilePackages: ["@hifago/ui", "@hifago/supabase", "@hifago/domain"],
};

export default nextConfig;
