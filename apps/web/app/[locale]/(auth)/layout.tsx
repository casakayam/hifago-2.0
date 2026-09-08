import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// Zone AUTH — connexion, inscription, vérification, mot de passe (spec 27 §0). Jamais indexée.
//
// `follow: true` volontaire : la page ne doit pas être indexée, mais ses liens (retour à l'accueil,
// bascule connexion/inscription) doivent rester suivis. `Disallow` et `noindex` ne se cumulent
// jamais sur une même page — `.claude/rules/seo.md` point 5.

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          Hifago
        </Link>
      </header>
      {children}
    </>
  );
}
