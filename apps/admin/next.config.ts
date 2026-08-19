import path from "node:path";
import type { NextConfig } from "next";

// Grilles de cartes /partner/products et /partner/establishment (photos du bucket catalog-media
// via next/image) — même dérivation du host que apps/web/next.config.ts, pour rester valide aussi
// bien en local (http://127.0.0.1:54321) qu'en cloud (https://<ref>.supabase.co).
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

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
  images: {
    remotePatterns: [
      {
        protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port || undefined,
        pathname: "/storage/v1/object/public/catalog-media/**",
      },
    ],
    // Garde anti-SSRF de Next 16 (bloque par défaut les IP privées comme 127.0.0.1) — sans risque
    // ici : remotePatterns ci-dessus scope déjà l'hôte exact.
    dangerouslyAllowLocalIP: true,
  },
};

export default nextConfig;
