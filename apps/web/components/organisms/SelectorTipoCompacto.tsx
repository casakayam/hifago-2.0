"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { TipoOferta } from "@/lib/catalog/tipos";

// Le déclencheur compact du sélecteur de type, pour l'écran étroit — 2026-09-14. Constaté en réel
// à 390×844 : la rangée de 5 onglets de `BarraNavegacion` déborde et se coupe net au bord de
// l'écran sans indice qu'elle défile, et sur un listing le type actif se répète trois fois en
// quelques lignes (fil d'Ariane, onglet actif, `<h1>`) — décision de Jérôme : sous `md`, un seul
// bouton ouvrant les 5 choix ; `BarraNavegacion` garde la rangée d'onglets à partir de `md`.
//
// ⚠️ MÊME PATTERN QUE `LanguageSwitcher`, et pour la MÊME raison — PAS de `Dropdown`/`Popover` de
// HeroUI : mesuré en rendu serveur le 2026-09-02 sur `LanguageSwitcher`, un tel composant ne monte
// AUCUN de ses liens dans le HTML servi tant qu'il est fermé (react-aria). Ici les liens sont
// justement les 5 routes de catalogue (`/camps`, `/eventos`…) — les masquer du HTML servi les
// retirerait du maillage interne pour Googlebot, qui indexe la version MOBILE, précisément l'écran
// où ce composant vit. Le panneau est donc TOUJOURS rendu et seulement masqué (`hidden`), et
// `Échap`/le clic à l'extérieur/le retour du focus sont écrits à la main, comme dans
// `LanguageSwitcher` — ce qu'un popover aurait donné gratuitement.
//
// ⚠️ Liste en texte plein, PAS les chips colorées de `TypeNavLink` : dans un panneau vertical
// compact, la couleur décorative de `TypeBadge` n'apporte rien (elle sert à distinguer un type au
// milieu d'une carte de catalogue, pas dans une liste déjà labellisée) et alourdirait visuellement
// ce qui doit rester un menu texte, comme les entrées de `LanguageSwitcher`.
export type SelectorTipoCompactoProps = {
  /** Toujours les 5 types, dans l'ordre — jamais un sous-ensemble. */
  tipos: { tipo: TipoOferta; label: string; href: string }[];
  /** Absent sur la home : le déclencheur affiche alors `etiqueta` au lieu d'un libellé de type. */
  tipoActivo?: TipoOferta;
  /** Nom accessible du groupe ET libellé du déclencheur quand aucun type n'est actif. */
  etiqueta: string;
  testId?: string;
};

function Chevron({ ouvert }: { ouvert: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${ouvert ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}

export function SelectorTipoCompacto({ tipos, tipoActivo, etiqueta, testId }: SelectorTipoCompactoProps) {
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  const conteneur = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);

  // Ce qu'un popover react-aria aurait apporté seul (voir l'en-tête) : `Échap` ferme et REND LE
  // FOCUS au bouton — sans ce retour, le focus reste sur un élément masqué et la tabulation repart
  // du début du document.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key !== "Escape") return;
      setOuvert(false);
      declencheur.current?.focus();
    };
    const surClic = (evenement: MouseEvent) => {
      if (!conteneur.current?.contains(evenement.target as Node)) setOuvert(false);
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("mousedown", surClic);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("mousedown", surClic);
    };
  }, [ouvert]);

  const activo = tipos.find((t) => t.tipo === tipoActivo);

  return (
    <div ref={conteneur} className="relative" data-testid={testId}>
      <button
        ref={declencheur}
        type="button"
        // ⚠️ `min-h-11` : cible tactile de 44 px (components/README.md) — même famille que le
        // déclencheur de `LanguageSwitcher`.
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium hover:bg-default focus-visible:status-focused"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((estado) => !estado)}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <span>{activo?.label ?? etiqueta}</span>
        <Chevron ouvert={ouvert} />
        {/* Ce que le bouton EST, pour un lecteur d'écran : le libellé seul ne dit pas qu'on peut
            changer de type. */}
        <span className="sr-only">&nbsp;— {etiqueta}</span>
      </button>

      {/* ⚠️ TOUJOURS rendu, seulement masqué : voir l'en-tête. Un `{ouvert && …}` sortirait les 5
          liens du HTML servi. */}
      <div
        id={idPanneau}
        hidden={!ouvert}
        className="absolute left-0 top-full z-10 mt-1 flex min-w-44 flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
        data-testid={testId ? `${testId}-panneau` : undefined}
      >
        {tipos.map(({ tipo, label, href }) => {
          const actual = tipo === tipoActivo;
          return (
            <Link
              key={tipo}
              href={href}
              // `aria-current` plutôt qu'un signe visuel seul — même règle que `LanguageSwitcher`.
              aria-current={actual ? "page" : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-3 text-sm hover:bg-default focus-visible:status-focused"
              onClick={() => setOuvert(false)}
              data-testid={testId ? `${testId}-${tipo}` : undefined}
            >
              <span>{label}</span>
              {actual ? <span className="sr-only">({etiqueta})</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
