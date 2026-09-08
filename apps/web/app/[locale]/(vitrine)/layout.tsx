import type { ReactNode } from "react";
import { CoquillaVitrine } from "./CoquillaVitrine";

// Zone VITRINE — la seule indexable (spec 27 §0).
//
// ⚠️ Ce layout ne pose PAS de `<main>`. L'atome `PageShell` en pose un, et son en-tête le dit —
// « l'unique `<main>` d'une page ». Les deux ensemble donneraient deux `<main>` imbriqués : faute
// de structure et défaut d'accessibilité, invisibles au typecheck comme au lint. C'est la page qui
// pose le sien (spec 27 §5, corrigé le 2026-09-07 après l'audit de la spec 28).
//
// ⚠️ Il n'importe rien de `@hifago/ui` : le barrel casserait `next build` depuis un Server
// Component, et par TRANSITIVITÉ un composant sans `"use client"` importé ici ferait la même chose.
// D'où `CoquillaVitrine`, qui porte `"use client"`.

export default function VitrineLayout({ children }: { children: ReactNode }) {
  return <CoquillaVitrine>{children}</CoquillaVitrine>;
}
