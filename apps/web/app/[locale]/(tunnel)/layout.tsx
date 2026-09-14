import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CoquillaTunel } from "./CoquillaTunel";

// Zone TUNNEL — panier, paiement, résultat (spec 27 §0). Jamais indexée.
//
// ⚠️ En-tête COMPLET depuis le 2026-09-14 (retour Jérôme, CoquillaTunel.tsx) — la décision
// initiale (« en-tête réduit à un retour vers l'accueil, ni menu ni panier : une fois qu'un
// visiteur paie, tout ce qui l'emmène ailleurs est une fuite ») est abandonnée POUR LE HEADER.
//
// Ce qui RESTE vrai, et a compté dans une décision distincte non remise en cause : **cette zone
// n'a toujours PAS de pied de page**, donc l'écran de confirmation n'y porte AUCUN contact
// WhatsApp. C'est ce qui invalidait la première justification du retrait du WhatsApp de la
// confirmation (cahier §2b.9) — le canal de suivi d'un invité est l'email de confirmation, pas un
// lien de pied de page qui n'existe pas ici.
//
// Pas de `<main>` ici non plus : la page pose le sien via `PageShell`.

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function TunnelLayout({ children }: { children: ReactNode }) {
  return <CoquillaTunel>{children}</CoquillaTunel>;
}
