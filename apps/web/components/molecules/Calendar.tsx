"use client";

import { createContext, useContext, useMemo, type ComponentProps } from "react";
import { cn, DayPickerCalendar, DayPickerCalendarDayButton } from "@hifago/ui";
import { isoDateToLocalMidnight } from "@hifago/domain";

// Le calendrier de la vitrine, entré dans le design system le 2026-09-02 (vague 6).
//
// ⚠️ CE COMPOSANT NE CONNAÎT AUCUNE RÈGLE MÉTIER, et c'est sa raison d'être. Les règles de
// réservation — nuits à check-out EXCLUSIF, `min_stay` ancré sur la nuit d'arrivée, `lead_days` qui
// relève le plancher, interdiction d'enjamber une nuit pleine — restent où elles ont été écrites et
// prouvées : `app/[locale]/products/[slug]/LodgingReservationForm.tsx` (journal des 2026-08-28 et
// 2026-08-29). Elles ne sont ni déplacées, ni recopiées, ni « généralisées » ici. L'anti-survente
// en dépend.
//
// La frontière est portée par le TYPE, pas par une consigne : ce composant reçoit `jours`, une
// liste de « pour cette date, voici son état et son étiquette ». Il ne reçoit JAMAIS de
// disponibilités à interpréter, et n'expose aucune prop qui lui permettrait de calculer un état.
// C'est aussi pour ça qu'`aujourdIso` est REQUIS : sans lui, react-day-picker prendrait
// `new Date()` du NAVIGATEUR (DayPicker.js:167) — exactement le bug du lot fuseau du 2026-08-28,
// que la règle eslint ne peut pas voir puisqu'il vit dans une dépendance.
//
// La brique reste `DayPickerCalendar` de `@hifago/ui`, INCHANGÉE — `apps/admin` l'utilise aussi.
// Le calendrier react-aria/HeroUI a été évalué deux fois (2026-08-17, 2026-08-29) et écarté sur le
// fond : le domaine est en nuits à sortie exclusive (CLAUDE.md §2 point 2). Sujet clos.
//
// `"use client"` obligatoire : react-day-picker est un composant client, et l'import passe par le
// barrel `@hifago/ui` (CLAUDE.md §11.16).

/**
 * Les trois états qu'un APPELANT déclare. Les quatre autres états visuels d'un jour —
 * sélectionné, dans la plage, aujourd'hui, hors du mois affiché — ne se déclarent pas : ils se
 * DÉDUISENT de `valeur`, d'`aujourdIso` et du mois affiché. Les mettre dans cette union aurait
 * permis de les contredire (un jour « sélectionné » hors de la sélection), donc de mentir.
 */
export type EtatJour = "disponible" | "complet" | "desactive";

export type JourCalendrier = {
  /** Date civile `yyyy-MM-dd`. Jamais un instant : un jour de calendrier n'en est pas un. */
  date: string;
  etat: EtatJour;
  /**
   * Court, affiché DANS la case — les places restantes aujourd'hui. Déjà traduit : une molecule
   * ne traduit rien elle-même. Rendu tel quel, à côté du numéro du jour.
   */
  etiquette?: string;
  /**
   * La même information en toutes lettres, pour un lecteur d'écran (« quedan 2 lugares »). Sans
   * elle, un « 2 » posé sous un numéro de jour n'est qu'un second nombre sans nom : le nom
   * accessible du bouton est construit ici, jamais deviné.
   */
  description?: string;
};

/** `fin` vaut `debut` au premier clic — react-day-picker pose `{from: X, to: X}` (2026-08-29). */
export type PlageCalendrier = { debut: string; fin: string | null };

/**
 * ⚠️ `selectionne` et `aujourdhui` ne sont pas décoratifs : react-day-picker écrit « Today, » et
 * « , selected » EN ANGLAIS EN DUR dans le nom accessible de chaque jour
 * (labels/labelDayButton.js), quelle que soit la locale. Les fournir est le seul moyen de ne pas
 * servir de l'anglais à un visiteur hispanophone.
 */
export type CalendarLibelles = {
  /** Ajouté au nom d'un jour complet, et repris tel quel dans la légende sous la grille. */
  complet: string;
  selectionne: string;
  aujourdhui: string;
};

type LocaleCalendrier = ComponentProps<typeof DayPickerCalendar>["locale"];

type CalendarBase = {
  /** Les jours dont l'appelant a quelque chose à dire. Les autres prennent `etatParDefaut`. */
  jours: JourCalendrier[];
  /**
   * L'état d'une date ABSENTE de `jours`. Le défaut est `"disponible"` — mais un formulaire de
   * réservation choisit `"desactive"` : une nuit dont on n'a jamais reçu la disponibilité n'est pas
   * réservable (acquis du 2026-08-28, échec fermé). Ce choix appartient à l'appelant, pas ici.
   */
  etatParDefaut?: EtatJour;
  /** REQUIS — `todayInBogota()`, jamais l'heure du navigateur. Voir l'en-tête. */
  aujourdIso: string;
  libelles: CalendarLibelles;
  /**
   * Mois affiché piloté par l'appelant (il sert de clé de fetch dans le formulaire réel). Les deux
   * champs vont ENSEMBLE : un `month` sans `onMonthChange` fige la navigation en silence côté
   * react-day-picker, d'où un objet plutôt que deux props qu'on pourrait dépareiller. Omis, le
   * calendrier ouvre sur `aujourdIso` et navigue tout seul.
   */
  moisAffiche?: { valeur: string; onChange: (moisIso: string) => void };
  /** Bornes de NAVIGATION (les flèches disparaissent au-delà), pas de sélection. */
  premierMoisIso?: string;
  dernierMoisIso?: string;
  /**
   * Locale date-fns. ⚠️ Omise, la grille est en ANGLAIS : c'est le cas en production aujourd'hui,
   * `LodgingReservationForm` ne la passe pas. Voir le §5 du rapport de vague.
   */
  locale?: LocaleCalendrier;
  testId?: string;
};

export type CalendarProps = CalendarBase &
  (
    | { mode: "single"; valeur: string | null; onValeurChange: (valeur: string | null) => void }
    | {
        mode: "range";
        valeur: PlageCalendrier | null;
        onValeurChange: (valeur: PlageCalendrier | null) => void;
      }
  );

// ⚠️ `--cell-size` vaut `--spacing(7)` = 28 px dans legacy-calendar, et `root` y vaut `w-fit` : la
// grille se replie donc sur 7 × 28 px, soit des cases de 28 px — très en dessous des 44 px exigés
// par components/README.md. Ce jeton pilote AUSSI la taille des deux boutons de navigation de mois,
// qui étaient donc eux aussi à 28 px. Mesuré, pas supposé (voir Calendar.test.tsx et le rapport).
//
// `w-full` bat `w-fit` par tailwind-merge : react-day-picker joint `classNames.root` puis le
// `className` reçu (DayPicker.js:216), et `CalendarRoot` repasse le tout dans `cn()` — le dernier
// gagne, et c'est le nôtre.
//
// ⚠️ `max-w-sm` n'est PAS une largeur en dur, c'est un PLAFOND, et il est aussi nécessaire que le
// `w-full` : sans lui, à 1280 px la grille occupait toute la page et `aspect-square` donnait des
// cases de 183 px de côté — un mur, mesuré en capture. `w-fit` réglait ce problème-là en créant
// l'autre. 24 rem laissent 52,6 px par case sur grand écran, contre 46,6 px sous `PageShell` à
// 390 px : la case ne varie qu'entre ces deux valeurs, quel que soit l'écran.
const CLASSE_CALENDRIER = "w-full max-w-sm [--cell-size:2.75rem]";

// ⚠️ « Aujourd'hui » et « au milieu de la plage » peignent le MÊME `bg-surface-secondary` dans
// legacy-calendar — l'un sur le `<td>`, l'autre sur le `<button>`. Sur une plage du 16 au 19 avec
// aujourd'hui au 15, la bande claire court donc du 15 au 19 et la sélection paraît commencer un
// jour trop tôt (vu en capture, pas déduit). On n'enlève pas le fond de la brique partagée — il
// faudrait parier sur l'ordre des utilitaires dans la feuille générée — on ajoute une marque qui
// ne dépend d'aucune couleur, sur le bouton, seul endroit où vit le numéro du jour.
const CLASSE_AUJOURDHUI = "font-bold underline decoration-2 underline-offset-4";

// ⚠️ LE POINT LE PLUS IMPORTANT DE CE FICHIER, et il contredit ce que fait la production.
//
// Un jour complet est `disabled` ET `complet` : react-day-picker empile donc DEUX opacités sur deux
// éléments emboîtés — `opacity-50` sur le `<td>` (son modificateur `disabled`, cf. BASE_CLASS_NAMES)
// et `opacity-50` sur le `<button>` (le `disabled:opacity-50` de `navButtonClassName`). Elles se
// MULTIPLIENT : 0,25. Le chiffre du jour, la seule information que ce calendrier doit absolument
// faire passer, s'affiche donc au quart de son opacité. Mesuré, pas déduit.
//
// ⚠️ Et le `line-through` que `LodgingReservationForm` pose sur la case NE BARRE RIEN : le numéro du
// jour vit dans le `<button>`, et un navigateur ne propage pas la décoration de texte à l'intérieur
// d'un contrôle de formulaire. C'est pour ça que le barré est posé ici sur le BOUTON — le
// modificateur, lui, ne peut atteindre que le `<td>` (piège du 2026-08-21).
//
// ⚠️ L'ESTOMPE EST RETIRÉE POUR LES DEUX ÉTATS NON CLIQUABLES, y compris « désactivé », et c'est
// une décision mesurée, pas un oubli. Sur les cinq pistes × deux modes, le numéro d'un jour barré
// ou passé vaut 1,36 à 1,70 contre son fond avec l'estompe empilée ; 2,25 à 3,05 avec une seule
// des deux ; 6,20 à 8,74 sans aucune, `--muted` faisant seul le travail pour lequel ce jeton
// existe. AUCUNE valeur intermédiaire ne passe 4,5 (mesuré à 0,5 / 0,6 / 0,7 / 0,8, sur
// `--muted` comme sur `--foreground`). Un jour dont on ne peut pas LIRE le numéro rend la grille
// inutilisable : WCAG 1.4.3 exempte les contrôles inactifs, mais l'exemption porte sur la couleur
// d'un bouton, pas sur la date qu'il faut savoir lire pour se repérer dans un mois.
const CLASSES_CASE: Record<"complet" | "desactive", string> = {
  complet: "opacity-100 text-foreground",
  desactive: "opacity-100",
};
const CLASSES_BOUTON: Record<EtatJour, string> = {
  disponible: "",
  // `disabled:opacity-100` bat `disabled:opacity-50` par tailwind-merge (même variante, même
  // groupe, le nôtre passé après) ; `text-foreground` défait le `text-muted` du `<td>`. Un texte
  // barré dit déjà « pas disponible » : le griser en plus ne dit rien de neuf et coûte le contraste.
  complet: "line-through text-foreground disabled:opacity-100",
  // Le `text-muted` du modificateur `disabled` reste : c'est lui qui distingue un jour éteint d'un
  // jour ouvert, et il est fait pour ça.
  desactive: "disabled:opacity-100",
};

// ⚠️ `[&>span]:opacity-70` vient de `dayButtonBaseClassName` (legacy-calendar) et s'applique à
// l'étiquette, qui est précisément le texte le plus petit de la grille. Neutralisé ici par
// tailwind-merge (même variante, même groupe, le nôtre est passé après).
const CLASSE_BOUTON_JOUR = "[&>span]:opacity-100";

/**
 * Date de grille → clé civile. Même format que `CalendarDay.isoDate`, donc que `data-day`.
 *
 * ⚠️ Construite à la main plutôt que par `format(date, "yyyy-MM-dd")`, et c'est mesuré :
 * react-day-picker réévalue le matcher `disabled` ET chaque modificateur pour les 42 cases à chaque
 * rendu (`createGetModifiers`, sans mémoïsation), soit ~170 appels par rendu — 0,24 ms avec date-fns
 * contre 0,013 ms ici. C'est déjà le choix fait pour cette raison exacte dans
 * `packages/ui/src/components/legacy-calendar.tsx` (`toIsoDate`).
 *
 * ⚠️ Composants LOCAUX, jamais `toISOString()`, qui décalerait la date d'un jour à Bogotá.
 */
function cle(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

/**
 * ⚠️ LA PARADE AU REMONTAGE DE LA GRILLE, et elle tient au fait que `BoutonJour` est écrit ICI, au
 * niveau du module.
 *
 * react-day-picker DÉMONTE et remonte les 42 cases dès que le TYPE du composant `DayButton` change
 * (documenté par `dateTaggedDayButtonComponents` dans legacy-calendar.tsx). La première version le
 * définissait DANS `Calendar`, mémoïsé sur `[parJour, etatParDefaut]` — une parade qui dépendait de
 * l'appelant, donc pas une parade : `DateRangeField` construit son tableau `jours` en ligne, il est
 * donc neuf à chaque rendu, `parJour` avec lui, et la grille entière était démontée puis remontée à
 * chaque frappe du formulaire englobant.
 *
 * Hissé au module, le type ne peut plus changer, quoi que fasse l'appelant. La donnée par jour lui
 * parvient alors par contexte — et pas par un `ref` écrit pendant le rendu, que la règle
 * `react-hooks/refs` du dépôt interdit, à raison.
 */
type DonneesJour = { parJour: Map<string, JourCalendrier>; etatParDefaut: EtatJour };

const ContexteJours = createContext<DonneesJour>({
  parJour: new Map(),
  etatParDefaut: "disponible",
});

// `boutonProps` et non `props` : le composant appelant a déjà une variable de ce nom, et l'ombrer
// rendrait illisible la ligne qui décide de la marque « aujourd'hui ».
function BoutonJour(boutonProps: ComponentProps<typeof DayPickerCalendarDayButton>) {
  const { parJour, etatParDefaut } = useContext(ContexteJours);
  // ⚠️ `day.isoDate`, pas `cle(day.date)` : `CalendarDay` calcule et stocke DÉJÀ cette clé au même
  // format à sa construction. 42 conversions par rendu, purement gratuites à supprimer.
  const iso = boutonProps.day.isoDate;
  const jour = parJour.get(iso);
  const etat = jour?.etat ?? etatParDefaut;
  const { modifiers } = boutonProps;
  return (
    <DayPickerCalendarDayButton
      {...boutonProps}
      data-date={iso}
      // Cible stable pour un test ou un e2e : l'état DÉCLARÉ, pas une classe à déchiffrer.
      data-etat={etat}
      className={cn(
        CLASSE_BOUTON_JOUR,
        CLASSES_BOUTON[etat],
        modifiers.today && !modifiers.selected && CLASSE_AUJOURDHUI
      )}
    >
      {boutonProps.children}
      {jour?.etiquette ? <span>{jour.etiquette}</span> : null}
    </DayPickerCalendarDayButton>
  );
}

// Constante de module : `components` ne peut donc pas non plus changer d'identité.
const COMPOSANTS = { DayButton: BoutonJour };

export function Calendar(props: CalendarProps) {
  const {
    jours,
    etatParDefaut = "disponible",
    aujourdIso,
    libelles,
    moisAffiche,
    premierMoisIso,
    dernierMoisIso,
    locale,
    testId,
  } = props;
  const { complet: libelleComplet, selectionne, aujourdhui } = libelles;
  const codeLocale = locale?.code;

  const parJour = useMemo(() => {
    const par = new Map<string, JourCalendrier>();
    for (const jour of jours) par.set(jour.date, jour);
    return par;
  }, [jours]);

  // ⚠️ PAS mémoïsés, contrairement à `composants` et `libellesRdp` juste en dessous — la différence
  // n'est pas un oubli. `disabled` et `modifiers` sont consommés par `createGetModifiers`
  // (DayPicker.js:138), une fonction ORDINAIRE rappelée à chaque rendu : leur identité n'est lue
  // nulle part. `components` et `labels`, eux, sont dans les dépendances du `useMemo` de tête de
  // DayPicker — d'où la mémoïsation, là et seulement là.
  const etatDe = (iso: string) => parJour.get(iso)?.etat ?? etatParDefaut;
  // Un seul prédicat pour les deux états non cliquables : « disponible » est le seul qui le soit.
  const nonSelectionnable = (date: Date) => etatDe(cle(date)) !== "disponible";
  const modificateurs = {
    complet: (date: Date) => etatDe(cle(date)) === "complet",
    desactive: (date: Date) => etatDe(cle(date)) === "desactive",
  };

  const donneesJour = useMemo(
    () => ({ parJour, etatParDefaut }),
    [parJour, etatParDefaut]
  );

  // Le nom accessible d'un jour, reconstruit entièrement. C'est le seul point d'entrée : un
  // `aria-label` sur un `<button>` remplace son contenu, donc un `sr-only` glissé dans la case
  // n'aurait jamais été lu.
  // ⚠️ UN formateur, pas quarante-deux. `labelDayButton` est appelé par react-day-picker une fois
  // par case, dans sa boucle de rendu ; `date.toLocaleDateString(code, options)` y instanciait un
  // formateur ICU à CHAQUE appel — 1,92 ms par rendu de grille, mesuré, de loin le poste le plus cher
  // du fichier. La chaîne produite est IDENTIQUE (la spec définit `toLocaleDateString(l, o)` comme
  // `new Intl.DateTimeFormat(l, o).format(this)`), `codeLocale` indéfini compris. 0,28 ms.
  const formatNomJour = useMemo(
    () =>
      new Intl.DateTimeFormat(codeLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [codeLocale]
  );

  const libellesRdp = useMemo(
    () => ({
      labelDayButton: (date: Date, modifiers: Record<string, boolean | undefined>) => {
        const jour = parJour.get(cle(date));
        const morceaux = [formatNomJour.format(date)];
        if (modifiers.today) morceaux.push(aujourdhui);
        if (modifiers.selected) morceaux.push(selectionne);
        if (jour?.description) morceaux.push(jour.description);
        else if (jour?.etat === "complet") morceaux.push(libelleComplet);
        return morceaux.join(", ");
      },
    }),
    [parJour, formatNomJour, aujourdhui, selectionne, libelleComplet]
  );

  const communs = {
    today: isoDateToLocalMidnight(aujourdIso),
    month: moisAffiche ? isoDateToLocalMidnight(moisAffiche.valeur) : undefined,
    onMonthChange: moisAffiche ? (mois: Date) => moisAffiche.onChange(cle(mois)) : undefined,
    defaultMonth: moisAffiche ? undefined : isoDateToLocalMidnight(aujourdIso),
    startMonth: premierMoisIso ? isoDateToLocalMidnight(premierMoisIso) : undefined,
    endMonth: dernierMoisIso ? isoDateToLocalMidnight(dernierMoisIso) : undefined,
    disabled: nonSelectionnable,
    modifiers: modificateurs,
    // ⚠️ Ces classes atterrissent sur le `<td>`, JAMAIS sur le `<button>` (piège du 2026-08-21) —
    // c'est ce qui rend `modifiersClassNames` incapable de barrer un numéro de jour, et pourquoi
    // `CLASSES_BOUTON` existe à côté. Elles s'ajoutent à celles du modificateur `disabled` de
    // react-day-picker, et passent après, donc elles gagnent.
    modifiersClassNames: { complet: CLASSES_CASE.complet, desactive: CLASSES_CASE.desactive },
    components: COMPOSANTS,
    labels: libellesRdp,
    locale,
    className: CLASSE_CALENDRIER,
  };

  // La légende n'apparaît que si elle a quelque chose à expliquer. Un mois sans nuit pleine ne
  // gagne rien à porter le mot « complet » sous sa grille.
  const aUnJourComplet = jours.some((jour) => jour.etat === "complet");

  return (
    // Le fournisseur porte la donnée par jour jusqu'à `BoutonJour`, hissé au module ci-dessus.
    <ContexteJours.Provider value={donneesJour}>
      <div className="flex w-full flex-col gap-2" data-testid={testId}>
      {props.mode === "range" ? (
        <DayPickerCalendar
          {...communs}
          mode="range"
          selected={
            props.valeur
              ? {
                  from: isoDateToLocalMidnight(props.valeur.debut),
                  to: props.valeur.fin ? isoDateToLocalMidnight(props.valeur.fin) : undefined,
                }
              : undefined
          }
          onSelect={(plage: { from?: Date; to?: Date } | undefined) =>
            props.onValeurChange(
              plage?.from ? { debut: cle(plage.from), fin: plage.to ? cle(plage.to) : null } : null
            )
          }
        />
      ) : (
        <DayPickerCalendar
          {...communs}
          mode="single"
          selected={props.valeur ? isoDateToLocalMidnight(props.valeur) : undefined}
          onSelect={(jour: Date | undefined) => props.onValeurChange(jour ? cle(jour) : null)}
        />
      )}
      {aUnJourComplet ? (
        <p
          className="flex items-center gap-2 px-2 text-sm"
          data-testid={testId ? `${testId}-legende` : undefined}
        >
          {/* Le motif lui-même, pas un jour d'exemple : un « 15 » barré en légende sous une grille
              où le 15 existe et n'est pas complet se lit comme une date, pas comme un échantillon. */}
          <span aria-hidden className="inline-block h-px w-5 bg-current" />
          {libelleComplet}
        </p>
      ) : null}
      </div>
    </ContexteJours.Provider>
  );
}
