"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/atoms/LinkButton";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Le footer de la vitrine (2026-09-02, vague 5). Avec le header livré la veille, l'app a enfin ses
// landmarks : `<header>`, `<main>` (PageShell), `<footer>`.
//
// ⚠️ `"use client"` obligatoire : ce fichier appelle `useTranslations` et rend `LinkButton`, qui
// importe le barrel `@hifago/ui` — dont le graphe fait planter `next build` dès qu'il atteint un
// Server Component (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ LES CINQ LIENS INSTITUTIONNELS POINTENT AUJOURD'HUI VERS DU VIDE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Aucune de ces pages n'existe (vérifié le 2026-09-02 : `app/[locale]/` ne contient ni `legal`, ni
// `privacy`, ni `contact`, ni `help`, ni `terms`). Ce lot n'en crée aucune — il livre le footer,
// pas le contenu légal, qui reste à rédiger (docs/01-cahier-des-charges-client.md, règle du
// 2026-08-11).
//
// La liste elle-même n'est pas inventée : elle vient de cette règle — mentions légales, politique
// de confidentialité (cadre Habeas Data colombien), contact, aide/FAQ, et conditions générales.
//
// D'où UNE SEULE constante : le jour où les routes existent, c'est le seul endroit à changer. Et
// tant qu'elles n'existent pas, ce footer mène à cinq 404 — c'est dit dans le rapport de lot,
// parce qu'un footer qui a l'air fini est pire qu'un footer visiblement en chantier.
const LIENS_INSTITUTIONNELS = [
  { href: "/legal", cle: "footerLegalNotice" },
  { href: "/privacy", cle: "footerPrivacy" },
  { href: "/contact", cle: "footerContact" },
  { href: "/help", cle: "footerHelp" },
  { href: "/terms", cle: "footerTerms" },
] as const;

// ⚠️ Le numéro de WhatsApp est DÉJÀ dans le dépôt : `apps/admin/lib/whatsapp.ts` porte le même
// (`SUPPORT_WHATSAPP_NUMBER`), lui-même repris du portail legacy (`public/reservar.js:15`), qui
// l'affiche sur toutes ses pages. Il est donc recopié ici plutôt qu'importé : `apps/admin` et
// `apps/web` sont deux applications, l'une n'importe pas l'autre.
//
// ⚠️ Cette troisième copie rend la remontée dans `packages/` justifiée au sens de CLAUDE.md §2.1 —
// la double consommation n'est plus supposée, elle est prouvée. C'est une décision d'architecture,
// donc signalée au coordinateur, pas prise ici.
const WHATSAPP_URL = "https://wa.me/573215764841";

export type SiteFooterProps = {
  testId?: string;
};

export function SiteFooter({ testId }: SiteFooterProps) {
  const t = useTranslations("Chrome");

  return (
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // ⚠️ LA BANDE DE COULEUR : `--surface-tertiary`, et le choix a été MESURÉ, pas jugé à l'œil
    // ─────────────────────────────────────────────────────────────────────────────────────────
    //
    // Aucune couleur en dur : cinq pistes de thème sont montées et aucune n'est adoptée
    // (`Playground/Palette`). Une valeur codée serait fausse dans quatre cas sur cinq, et fausse en
    // mode sombre.
    //
    // Cinq jetons mesurés (5 pistes × 2 modes, contraste de la bande contre `--background` et du
    // texte contre la bande) :
    //
    //   --surface              1.04–1.16 contre la page   → invisible
    //   --surface-secondary    1.05–1.38                  → presque invisible
    //   --surface-tertiary     1.10–1.66                  → retenu
    //   --accent               3.38–16.79, MAIS texte à 3.59:1 sur les défauts HeroUI (< 4.5)
    //   --background-inverse   12–20, franc — et inutilisable ici, voir plus bas
    //
    // ⚠️ POURQUOI PAS UN APLAT FRANC, qui serait plus proche de « une bande de couleur » :
    // `--background-inverse` et `--accent` retournent le fond, et ce footer CONTIENT des composants
    // dont les jetons supposent un fond de surface claire — le `LinkButton` WhatsApp rendrait son
    // texte en `--default-foreground` (sombre) sur un fond sombre, et le panneau du
    // `LanguageSwitcher` garde son `--surface`. Les reconfigurer pour un fond inversé est une
    // décision de design system, pas un choix de ce lot : c'est remonté au coordinateur avec les
    // chiffres. `--surface-tertiary` est le plus marqué des jetons qui laissent ces composants
    // intacts.
    //
    // Le filet du haut n'est donc pas décoratif : à 1.10 d'écart avec la page, c'est LUI qui fait
    // exister la bande. Même geste que le `border-b` du header.
    <footer
      className="border-t border-[var(--border)] bg-[var(--surface-tertiary)] text-[var(--surface-tertiary-foreground)]"
      data-testid={testId}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <nav aria-label={t("footerNavLabel")} data-testid={testId ? `${testId}-nav` : undefined}>
          {/* Mobile d'abord : la liste s'EMPILE à 390 px, elle ne se comprime pas — et rien n'est
              masqué selon la largeur, Google indexe le mobile. À partir de `sm` elle se replie sur
              deux ou trois colonnes de flux. */}
          <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {LIENS_INSTITUTIONNELS.map(({ href, cle }) => (
              <li key={href}>
                <Link
                  href={href}
                  // `min-h-11` : 44 px de cible tactile (components/README.md). Sur une liste de
                  // liens serrés, c'est ce qui les rend visables au pouce.
                  className="inline-flex min-h-11 items-center rounded-[var(--radius)] text-sm underline-offset-4 hover:underline focus-visible:status-focused"
                  data-testid={testId ? `${testId}-${cle}` : undefined}
                >
                  {t(cle)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* ⚠️ `LinkButton` avec `external`, pas un `<a>` écrit à la main : il impose
              `rel="noopener noreferrer"` (la prop `rel` n'existe pas, donc rien à oublier) et exige
              le libellé « nouvel onglet », rendu en sr-only. C'est exactement ce que ce composant
              existe pour rendre impossible à rater. */}
          <LinkButton
            href={WHATSAPP_URL}
            external
            newTabLabel={t("footerWhatsAppNewTab")}
            variant="outline"
            color="neutral"
            testId={testId ? `${testId}-whatsapp` : undefined}
          >
            {t("footerWhatsApp")}
          </LinkButton>

          {/* ⚠️ Le MÊME `LanguageSwitcher` que le header, réutilisé tel quel — pas un second
              sélecteur. Deux implémentations qui divergent (l'une qui navigue vraiment, l'autre en
              JavaScript seul) est le défaut classique de la paire header/footer, et il coûterait
              ici la découverte de la version anglaise. */}
          <LanguageSwitcher testId={testId ? `${testId}-language` : undefined} />
        </div>

        {/* La ligne d'identité, reprise du footer legacy (`public/index.html:503`).
            ⚠️ Pas de `text-muted` : mesuré à 4.21:1 sur cette bande avec les jetons de la
            production actuelle — sous le seuil WCAG de 4.5. La discrétion vient donc de la TAILLE
            et non de la couleur, et le texte hérite du `-foreground` de la bande, dont le thème
            garantit lui-même la lisibilité (14.7 à 15.6:1 mesurés). */}
        <p className="text-xs" data-testid={testId ? `${testId}-identity` : undefined}>
          {t("footerIdentity")}
        </p>
      </div>
    </footer>
  );
}
