import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// Zone TUNNEL — panier, paiement, résultat (spec 27 §0). Jamais indexée.
//
// En-tête volontairement RÉDUIT à un retour vers l'accueil : ni menu, ni panier, ni pied de page.
// Une fois qu'un visiteur paie, tout ce qui l'emmène ailleurs est une fuite.
//
// ⚠️ Conséquence à connaître, et elle a compté dans une décision : **cette zone n'a pas de pied de
// page**, donc l'écran de confirmation n'y porte AUCUN contact WhatsApp. C'est ce qui invalidait la
// première justification du retrait du WhatsApp de la confirmation (cahier §2b.9) — le canal de
// suivi d'un invité est l'email de confirmation, pas un lien de pied de page qui n'existe pas ici.
//
// Pas de `<main>` ici non plus : la page pose le sien via `PageShell`.

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function TunnelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-default-200 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          Hifago
        </Link>
      </header>
      {children}
    </>
  );
}
