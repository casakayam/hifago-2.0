"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Chevron } from "@/components/atoms/Chevron";
import { TypeNavLink } from "@/components/atoms/TypeNavLink";
import type { TipoOferta } from "@/lib/catalog/tipos";

// Le sélecteur de type — remplace, le 2026-09-15, à la fois la rangée de chips `TypeNavLink`
// (desktop) et le déclencheur déroulant `SelectorTipoCompacto` (mobile, supprimé) qui existaient
// avant sous l'ex-`BarraNavegacion.tsx`. Un seul rendu à TOUTES les largeurs : les items sont en
// ligne, et un bouton « Más » apparaît/se déplie sur une deuxième ligne uniquement quand la largeur
// réelle ne suffit pas — capture de l'app legacy montrée par Jérôme, ligne `cat-1` de la grille de
// suivi bêta (human-check : « je veux les onglets sur mobile », pas un menu qui cache les liens).
//
// ⚠️ CE `<nav>` PORTE SON PROPRE `ref` DE MESURE, POINT SUR LEQUEL IL NE PEUT PAS ÊTRE PARTAGÉ :
// à sa création, il vivait dans un composant `BarraNavegacion.tsx` qui le composait avec `<Migas>`
// (fil d'Ariane) sur les mêmes pages ; ce composant a été supprimé le 2026-09-15 (retour de
// Jérôme : `SelectorTipo` remplace `Migas` sur la home, `Migas` reste seul partout ailleurs — plus
// aucune page ne montre les deux ensemble). La contrainte qui a motivé ce `ref` séparé reste
// d'actualité malgré tout : `[data-testid="migas"]` (sur les 4 autres pages) et `[data-testid=
// "selector-tipos"]` (sur la home) sont deux `<nav>` distincts, jamais fusionnés — garde-fou
// `e2e/categorias.spec.ts` sur le compte de `a[href]` dans `[data-testid="migas"]`.
//
// ⚠️ ÉTAT PAR DÉFAUT SÛR : tant que rien n'est mesuré (SSR, no-JS, avant le premier effet),
// `cantidadVisible` reste `null` → AUCUN item ne porte `hidden`, le bouton « Más » ne rend même
// pas. Le HTML servi est donc toujours « 5 liens réels, rien de masqué » — même principe que
// `SelectorTipoCompacto` avant lui (contenu jamais retiré du DOM selon la largeur, règle SEO/a11y
// `.claude/rules/ui.md` : Google indexe la version mobile), mais plus simple à défendre puisqu'il
// n'y a même pas besoin de justifier un panneau `hidden` toujours présent.
//
// ⚠️ MESURE PAR LARGEURS CUMULÉES, PAS PAR `offsetTop` (revu le 2026-09-15 — constaté en réel :
// la première version comparait juste les `offsetTop` des 5 items pour savoir combien tiennent
// sur la ligne 1, SANS jamais compter la largeur du bouton « Más » lui-même. Résultat : « Más »
// pouvait tenir tout seul, en trop, et passait à la ligne 2 — exactement l'inverse de l'effet
// voulu). L'algorithme calcule maintenant, dans l'ordre : (1) la largeur cumulée des 5 items
// (`offsetWidth` + l'espace `gap-x-4` entre eux) tient-elle dans `clientWidth` du conteneur ? Si
// oui, personne ne déborde, `Más` ne sert à rien. (2) Sinon, quel est le plus grand nombre
// d'items dont la largeur cumulée PLUS un espace PLUS la largeur du bouton « Más » tient encore ?
// Ce nombre devient `cantidadVisible`. La largeur de « Más » est lue sur un CLONE invisible
// (`masMedidorRef`, `position: absolute` — hors du flux, ne perturbe jamais la ligne réelle) posé
// à demeure : le vrai bouton n'existe dans le DOM QUE quand `desborda` est vrai, mais sa largeur
// doit être connue AVANT de savoir s'il déborde.
//
// ⚠️ `HUECO_PX` DOIT RESTER SYNCHRONISÉ AVEC `gap-x-4` DE LA CLASSE DU CONTENEUR CI-DESSOUS — pas
// de mesure DOM du `gap` lui-même (`getComputedStyle` renvoie une chaîne vide en environnement de
// test, jsdom n'applique aucune feuille de style réelle) : une constante documentée, comme le
// `scroll-px-2` de `CarruselConSombra`, plutôt qu'une lecture qui échouerait silencieusement en
// test. Si la classe change, cette constante doit suivre.
//
// ⚠️ `useLayoutEffect`, PAS `useEffect`, pour la mesure : un flash ici serait un vrai saut de mise
// en page (5 onglets → recalcul → 3 onglets + Más), pénalisant pour le CLS. `useLayoutEffect`
// mesure et replie AVANT la première peinture. Gardé derrière `typeof window` : sur le rendu
// serveur, `useLayoutEffect` ne fait rien mais avertit en dev (« ne peut pas s'encoder en HTML ») —
// `useEffect` n'y tourne pas plus, mais ne prévient personne pour rien.
//
// ⚠️ `ResizeObserver` SUR LA LARGEUR SEULEMENT, JAMAIS LA HAUTEUR : masquer des items réduit la
// hauteur du conteneur (moins de lignes), jamais sa largeur. Sans ce filtre, notre propre repli
// redéclencherait une mesure qui verrait « tout tient » (les items cachés ne comptent plus dans le
// layout), déplierait tout, ce qui redéclencherait une mesure… boucle infinie. Piège spécifique à
// CE composant (absent de `CarruselConSombra`, qui ne cache jamais rien), documenté ici au même
// titre que le `scroll-px-2` de `CarruselConSombra`.
//
// ⚠️ AU RESIZE, TOUT REDÉPLIER AVANT DE REMESURER : un item déjà caché (`hidden`) ne pèse plus
// aucune largeur, donc le remesurer directement depuis l'état replié sous-estimerait combien
// d'items tiennent maintenant. Le `ResizeObserver` repasse donc `cantidadVisible` à `null` (« rien
// mesuré ») avant tout, ce qui redéclenche l'effet de mesure sur un DOM totalement déplié.
//
// ⚠️ PAS DE FERMETURE ÉCHAP / CLIC EXTÉRIEUR (contrairement à `SelectorTipoCompacto`) : ce n'est
// plus un panneau flottant qui recouvre du contenu, juste un accordéon inline qui pousse la suite
// de la page vers le bas — ce comportement de popover n'a plus de sens ici. Absence volontaire, pas
// un oubli.
const useMedidaLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

// `gap-x-4` = 1rem = 16px à la taille de police racine par défaut (16px) — voir l'en-tête.
const HUECO_PX = 16;

export type SelectorTipoProps = {
  /** Toujours les 5 types, dans l'ordre — jamais un sous-ensemble. */
  tipos: { tipo: TipoOferta; label: string; href: string }[];
  /** Absent sur la home : aucun type n'y est "le" sujet de la page. */
  tipoActivo?: TipoOferta;
  /** aria-label du <nav>. */
  etiqueta: string;
  /** Déjà traduit — affiché replié (ex. "Más"). */
  masEtiqueta: string;
  /** Déjà traduit — affiché déplié (ex. "Menos"). */
  menosEtiqueta: string;
  testId?: string;
};

export function SelectorTipo({
  tipos,
  tipoActivo,
  etiqueta,
  masEtiqueta,
  menosEtiqueta,
  testId,
}: SelectorTipoProps) {
  const filaRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const masMedidorRef = useRef<HTMLSpanElement>(null);
  const anchoRef = useRef<number | null>(null);
  const idFila = useId();

  // `null` : rien mesuré, défaut sûr (voir en-tête). Une fois mesuré, le nombre d'items qui
  // tiennent sur la première ligne (« Más » compris dans le calcul quand il déborde).
  const [cantidadVisible, setCantidadVisible] = useState<number | null>(null);
  const [desplegado, setDesplegado] = useState(false);

  // Mesure : au montage, ET à chaque remesure demandée par le `ResizeObserver` ci-dessous (qui
  // repasse `cantidadVisible` à `null` avant). Tant que `cantidadVisible` est `null`, rien n'est
  // masqué, donc `offsetWidth` reflète la vraie largeur des 5 items, pas celle d'un sous-ensemble
  // déjà replié.
  useMedidaLayout(() => {
    if (cantidadVisible !== null) return;
    const fila = filaRef.current;
    const masMedidor = masMedidorRef.current;
    const items = itemRefs.current;
    if (!fila || !masMedidor || items.length === 0 || items.some((el) => !el)) return;

    const disponible = fila.clientWidth;
    // ⚠️ GARDE-FOU : un conteneur pas encore mis en page (ou réellement large de 0px — jsdom en
    // test, un ancêtre `display:none` un instant en vrai navigateur) ne doit JAMAIS se lire comme
    // « rien ne tient ». Sans ce retour anticipé, les `HUECO_PX` fixes entre items (non nuls même
    // si `offsetWidth` vaut 0 partout) feraient dépasser `disponible` par la seule somme des
    // espaces — tout serait mesuré « en débordement » par un pur artefact de mesure, jamais un vrai
    // manque de place. Défaut sûr : tout tient, comme documenté en tête de fichier.
    if (disponible <= 0) {
      setCantidadVisible(tipos.length);
      return;
    }
    const anchos = items.map((el) => el!.offsetWidth);

    // Largeur cumulée des N premiers items (gaps internes compris) — prefijos[n-1] = les n premiers.
    const prefijos: number[] = [];
    anchos.reduce((acumulado, ancho, indice) => {
      const total = acumulado + ancho + (indice > 0 ? HUECO_PX : 0);
      prefijos.push(total);
      return total;
    }, 0);

    // (1) Les 5 tiennent-ils seuls, sans "Más" ? `+1` : tolérance sous-pixel, même esprit que le
    // `>1` de `CarruselConSombra`.
    if (prefijos[prefijos.length - 1] <= disponible + 1) {
      setCantidadVisible(tipos.length);
      return;
    }

    // (2) Débordement réel : le plus grand nombre d'items dont la largeur cumulée + un espace +
    // la largeur de "Más" (mesurée sur le clone invisible) tient encore.
    const anchoMas = masMedidor.offsetWidth;
    let n = tipos.length;
    while (n > 0 && prefijos[n - 1] + HUECO_PX + anchoMas > disponible + 1) n--;
    setCantidadVisible(n);
  }, [cantidadVisible]);

  useEffect(() => {
    const fila = filaRef.current;
    if (!fila) return;
    anchoRef.current = fila.clientWidth;
    const observador = new ResizeObserver(() => {
      const el = filaRef.current;
      if (!el) return;
      if (anchoRef.current !== null && Math.abs(el.clientWidth - anchoRef.current) < 1) return;
      anchoRef.current = el.clientWidth;
      setCantidadVisible(null);
      setDesplegado(false);
    });
    observador.observe(fila);
    return () => observador.disconnect();
  }, []);

  const limite = cantidadVisible ?? tipos.length;
  const desborda = limite < tipos.length;

  return (
    <nav aria-label={etiqueta} data-testid={testId}>
      <div
        ref={filaRef}
        id={idFila}
        // Propre testid (suffixe `-fila`) pour que `SelectorTipo.test.tsx` puisse simuler son
        // `clientWidth` — c'est CE conteneur, pas le `<nav>`, dont la largeur borne la mesure.
        data-testid={testId ? `${testId}-fila` : undefined}
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        {tipos.map(({ tipo, label, href }, indice) => (
          <span
            key={tipo}
            ref={(el) => {
              itemRefs.current[indice] = el;
            }}
            // Le `ref` mesuré est ce `<span>`, pas le lien qu'il enveloppe — son propre testid
            // (suffixe `-item`, distinct de celui du lien) permet à `SelectorTipo.test.tsx` de
            // simuler une largeur par item (jsdom ne fait aucune vraie mise en page).
            data-testid={testId ? `${testId}-${tipo}-item` : undefined}
            hidden={!desplegado && indice >= limite}
          >
            <TypeNavLink
              label={label}
              href={href}
              activo={tipo === tipoActivo}
              testId={testId ? `${testId}-${tipo}` : undefined}
            />
          </span>
        ))}

        {desborda ? (
          <button
            type="button"
            aria-expanded={desplegado}
            aria-controls={idFila}
            onClick={() => setDesplegado((valor) => !valor)}
            className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-medium text-default-500 hover:text-foreground focus-visible:status-focused"
            data-testid={testId ? `${testId}-mas` : undefined}
          >
            {desplegado ? menosEtiqueta : masEtiqueta}
            <Chevron ouvert={desplegado} />
          </button>
        ) : null}

        {/* Clone invisible et hors flux (`absolute`) du bouton "Más" replié — voir l'en-tête :
            sa largeur doit être connue AVANT de savoir si "Más" déborde, donc avant que le vrai
            bouton n'existe dans le DOM. Ne perturbe jamais la ligne réelle ni sa hauteur. */}
        <span
          ref={masMedidorRef}
          aria-hidden="true"
          data-testid={testId ? `${testId}-mas-medidor` : undefined}
          className="invisible absolute inline-flex min-h-11 items-center gap-1 px-1 text-sm font-medium"
        >
          {masEtiqueta}
          <Chevron ouvert={false} />
        </span>
      </div>
    </nav>
  );
}
