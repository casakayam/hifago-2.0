"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/messages";

// Le sélecteur de langue de la vitrine (2026-09-02, vague 4).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// TROIS DÉCISIONS, TOUTES VÉRIFIÉES PLUTÔT QUE SUPPOSÉES
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ CE SONT DE VRAIS LIENS, jamais `useRouter().replace()`. Un sélecteur qui ne navigue qu'en
//    JavaScript ne produit aucun `<a href>` : la version anglaise n'est alors découverte par aucun
//    maillage interne, et le sélecteur ne marche pas sans JS. Le `Link` de `@/i18n/navigation`
//    accepte une prop `locale` — `<Link href={pathname} locale="en">` rend un vrai `/en/…`.
//
// 2. ⚠️ PAS de `Dropdown`/`Popover` de HeroUI, et ce n'est pas un choix de style. Mesuré en rendu
//    SERVEUR (`renderToStaticMarkup`) le 2026-09-02 : un `Dropdown` fermé ne contient AUCUN de ses
//    liens dans le HTML servi — react-aria ne monte le contenu qu'à l'ouverture. Or sur mobile ce
//    sélecteur vit dans le menu du header, et Googlebot indexe la version mobile : les liens de
//    langue disparaîtraient donc du seul HTML qu'il voit. Ici le panneau est TOUJOURS rendu et
//    seulement masqué (`hidden`), ce que `LanguageSwitcher.test.tsx` vérifie en SSR.
//    Contrepartie assumée : `Échap`, le clic à l'extérieur et le retour du focus sont écrits à la
//    main plus bas — c'est ce que le popover aurait donné gratuitement.
//
// 3. ⚠️ LE DRAPEAU N'EST JAMAIS SEUL À PORTER L'INFORMATION (même règle que la couleur, dans
//    components/README.md). Deux raisons : les drapeaux en emoji ne s'affichent PAS sous Windows
//    (le système n'embarque aucun glyphe de drapeau, `🇨🇴` y rend « CO ») — d'où des SVG inline ;
//    et surtout aucun drapeau ne « dit » une langue. `es` est ici l'espagnol de COLOMBIE (le site
//    vend à Guatapé), donc le drapeau colombien plutôt que celui de l'Espagne ; pour l'anglais,
//    aucun drapeau n'est juste — l'Union Jack est un pis-aller, signalé comme tel au coordinateur.
//    Le nom de la langue est donc toujours écrit à côté.
export type LanguageSwitcherProps = {
  testId?: string;
};

// ⚠️ Les noms de langue ne sont PAS des chaînes traduisibles : chaque langue s'écrit dans la
// sienne (un anglophone perdu sur /es doit lire « English », pas « Inglés »). Ils ne passent donc
// pas par les messages — même parti pris que `.storybook/preview.tsx`, qui porte déjà cette table.
const ENDONYMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

function DrapeauColombie() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="24" height="8" fill="#FCD116" />
      <rect y="8" width="24" height="4" fill="#003893" />
      <rect y="12" width="24" height="4" fill="#CE1126" />
    </svg>
  );
}

function DrapeauRoyaumeUni() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10" aria-hidden="true">
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#FFF" strokeWidth="3" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M12 0v16M0 8h24" stroke="#FFF" strokeWidth="5" />
      <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3" />
    </svg>
  );
}

const DRAPEAUX: Record<Locale, () => React.ReactElement> = {
  es: DrapeauColombie,
  en: DrapeauRoyaumeUni,
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

export function LanguageSwitcher({ testId }: LanguageSwitcherProps) {
  const t = useTranslations("Chrome");
  const chemin = usePathname();
  // La locale rendue vient de next-intl, jamais de l'URL : `usePathname` de `@/i18n/navigation`
  // retire justement le préfixe de locale, il ne peut donc pas la donner.
  const locale = useLocale() as Locale;
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  const conteneur = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);

  // Ce qu'un popover react-aria aurait apporté seul (voir le point 2 de l'en-tête) : `Échap` ferme
  // et REND LE FOCUS au bouton — sans ce retour, le focus reste sur un élément masqué et la
  // tabulation repart du début du document.
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

  const DrapeauCourant = DRAPEAUX[locale];

  return (
    <div ref={conteneur} className="relative" data-testid={testId}>
      <button
        ref={declencheur}
        type="button"
        // ⚠️ `min-h-11` : cible tactile de 44 px (components/README.md), comme toute la famille des
        // boutons. Un sélecteur de langue est une cible qu'on vise au pouce.
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-3 text-sm font-medium hover:bg-default focus-visible:status-focused"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        onClick={() => setOuvert((etat) => !etat)}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <DrapeauCourant />
        <span>{ENDONYMES[locale]}</span>
        <Chevron ouvert={ouvert} />
        {/* Ce que le bouton EST, pour un lecteur d'écran : le drapeau et le nom ne disent pas qu'on
            peut changer de langue. */}
        <span className="sr-only">&nbsp;— {t("languageLabel")}</span>
      </button>

      {/* ⚠️ TOUJOURS rendu, seulement masqué : c'est ce qui met les liens `/en/…` dans le HTML que
          Googlebot reçoit. Un `{ouvert && …}` les en sortirait — voir le point 2 de l'en-tête. */}
      <div
        id={idPanneau}
        hidden={!ouvert}
        className="absolute right-0 top-full z-10 mt-1 flex min-w-44 flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
        data-testid={testId ? `${testId}-panneau` : undefined}
      >
        {routing.locales.map((valeur) => {
          const Drapeau = DRAPEAUX[valeur];
          const courante = valeur === locale;
          return (
            <Link
              key={valeur}
              href={chemin}
              locale={valeur}
              // `aria-current` plutôt qu'une coche seule : l'information « c'est la langue active »
              // ne doit pas dépendre d'un signe visuel.
              aria-current={courante ? "true" : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-3 text-sm hover:bg-default focus-visible:status-focused"
              onClick={() => setOuvert(false)}
              data-testid={testId ? `${testId}-${valeur}` : undefined}
            >
              <Drapeau />
              <span>{ENDONYMES[valeur]}</span>
              {courante ? <span className="sr-only">({t("languageCurrentLabel")})</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
