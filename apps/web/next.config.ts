import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// docs/specs/04-gestion-images.md §10 — next/image charge les photos du bucket public
// catalog-media : le host est dérivé de NEXT_PUBLIC_SUPABASE_URL plutôt que codé en dur, pour
// rester valide aussi bien en local (http://127.0.0.1:54321) qu'en cloud (https://<ref>.supabase.co).
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
    // Nouvelle garde anti-SSRF de Next 16 (bloque par défaut les IP privées comme 127.0.0.1,
    // constaté en testant en local) — sans risque ici : remotePatterns ci-dessus scope déjà
    // l'hôte exact, cette option ne fait que lever le refus générique sur les IP locales.
    dangerouslyAllowLocalIP: true,
  },
  // Feature 32 — runbook tunnel Mercado Pago (docs/journal/2026-08.md, 2026-08-20 suite 8) :
  // Next 16 bloque par défaut les requêtes cross-origin vers le dev server. Nécessaire
  // uniquement pour naviguer via l'URL publique du tunnel cloudflared (jamais utilisé sinon,
  // aucun risque en local pur) — l'URL exacte change à chaque lancement (tunnel éphémère, sans
  // compte), d'où le wildcard plutôt qu'un hôte fixe.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
