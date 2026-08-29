"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Link } from "@/i18n/navigation";
import {
  Button,
  DayPickerCalendar as Calendar,
  DayPickerCalendarDayButton,
  Input,
  Label,
  TextField,
} from "@hifago/ui";
import {
  addDaysIso,
  formatCop,
  isoDateToLocalMidnight,
  lastBookableDateIso,
  startOfTodayInBogota,
  todayInBogota,
  type LobbyNightRestrictions,
  type LodgingKind,
} from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import {
  buildInCartNightsMap,
  estimateNightsTotal,
  hasUnavailableNightInRange,
  nightsInRange,
  reachableRangeWindow,
  resolveTierPrice,
  type PriceTier,
} from "@/lib/products/reservationRange";

// Spec 17 §0 Tranche 2, §10 point 6 — react-day-picker mode="range", tranché sur prototype réel
// (cf. docs/journal/2026-08.md). Une seule entité tarifée : le produit lui-même, via
// product_date_rates/price_tiers.
//
// Ce composant a eu un jumeau, HotelReservationForm.tsx, qui ajoutait un sélecteur de chambre
// avant le calendrier. T3 (2026-08-27) a supprimé l'étage hôtel : chaque chambre est devenue un
// produit, et ce formulaire les sert toutes.
type AvailabilityRow = { date: string; capacity: number; booked: number };
type RateRow = { date: string; price_cop: number };

// Une nuit est RÉSERVABLE si son restant couvre la quantité demandée. Seuil `qty`, jamais 0 — une
// nuit à 2 places restantes n'est pas réservable pour 3, même si elle n'est pas complète. Le restant
// passé ici est déjà net du panier en cours (`remainingByDate`). Une nuit ABSENTE de la map n'est
// pas réservable : c'est ce qui couvre la nuit jamais récupérée, acquis du 2026-08-28.
//
// Au niveau module, et pas dans le corps du composant : le compilateur React refuse de préserver une
// mémoïsation dont le résultat est une fonction (react-hooks/preserve-manual-memoization), et une
// fonction stable ici n'a aucune dépendance à déclarer.
// `min_stay` de la nuit d'ARRIVÉE — c'est elle qui commande la longueur du séjour, pas la sortie.
//
// ⚠️ `null` veut dire « Lobby n'a rien dit », JAMAIS « Lobby dit zéro ». Le relevé garde la
// distinction (packages/domain/src/pms/parseLobbyNightCatalog.ts, verrouillé par son test) ; ici on
// choisit un défaut d'APPLICATION — une nuit, le minimum structurel d'un séjour — sans jamais
// réécrire l'observation. Une nuit absente de la map n'a simplement aucune contrainte relevée.
function nuitsMinimumPour(restrictions: Map<string, LobbyNightRestrictions>, arriveeIso: string): number {
  const minStay = restrictions.get(arriveeIso)?.minStay;
  return minStay === null || minStay === undefined ? 1 : minStay;
}

function nuitReservable(restants: Map<string, number>, iso: string, pourQty: number): boolean {
  const restant = restants.get(iso);
  return restant !== undefined && restant >= pourQty;
}

export function LodgingReservationForm({
  productId,
  productName,
  establishmentName,
  priceCop,
  priceTiers,
  maxQty,
  lodgingKind,
  isPmsBacked,
  availability,
  rates,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  maxQty: number;
  lodgingKind: LodgingKind | null;
  isPmsBacked: boolean;
  availability: AvailabilityRow[];
  rates: RateRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();

  // Borne HAUTE de l'horizon produit (six mois, décidé le 2026-08-28). Calculée une fois au montage
  // plutôt qu'à chaque rendu, pour que react-day-picker reçoive la même référence.
  const dernierJourReservable = useMemo(() => isoDateToLocalMidnight(lastBookableDateIso()), []);

  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  // Spec 21 §13 — un alojamiento PMS-backed n'a jamais de product_availability peuplée (Lobby fait
  // foi) : `availability` (prop SSR) reste vide, remplacée par un fetch client mois par mois.
  //
  // L'ÉTAT EST PAR MOIS, et c'est le correctif du 2026-08-28. Avant, `pmsError` était un booléen
  // GLOBAL au composant (un mois en échec suivi d'un mois réussi effaçait la bannière), et surtout
  // `loadedMonthsRef` marquait le mois « chargé » MÊME EN ÉCHEC : plus rien ne le retentait de toute
  // la session. Comme la panne mesurée est transitoire — novembre est revenu 0, puis 29/30, puis
  // 30/30 — ce qui manquait n'était pas un meilleur message, c'était de REDEMANDER.
  type PmsMonthState =
    | { status: "loading" }
    | { status: "ready" }
    | { status: "error"; reason: string; retryAfterSeconds: number | null };

  // Mois ouvert au premier rendu — et donc CLÉ DU FETCH (`monthKey` juste en dessous, envoyé tel
  // quel à /api/pms/night-availability). C'était le pire des dix sites du lot fuseau : avec
  // `new Date()`, un visiteur européen le 1er du mois à 2 h du matin demandait à LobbyPMS le mois
  // SUIVANT, et le calendrier qu'il regardait n'était jamais celui qu'on venait de charger.
  const [visibleMonth, setVisibleMonth] = useState(() => startOfTodayInBogota());
  const [pmsAvailability, setPmsAvailability] = useState<Map<string, AvailabilityRow>>(new Map());
  // Les restrictions Lobby de CETTE catégorie, nuit par nuit. Elles sont PAR CATÉGORIE : deux
  // produits d'une même catégorie les partagent, deux catégories du même établissement peuvent
  // différer — d'où une map locale au composant, jamais un cache partagé entre produits.
  const [pmsRestrictions, setPmsRestrictions] = useState<Map<string, LobbyNightRestrictions>>(new Map());
  const [pmsMonths, setPmsMonths] = useState<Map<string, PmsMonthState>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const loadedMonthsRef = useRef<Set<string>>(new Set());

  const monthKey = useMemo(() => format(visibleMonth, "yyyy-MM"), [visibleMonth]);

  useEffect(() => {
    if (!isPmsBacked || loadedMonthsRef.current.has(monthKey)) return;
    let cancelled = false;
    const setMonth = (state: PmsMonthState) =>
      setPmsMonths((prev) => new Map(prev).set(monthKey, state));
    setMonth({ status: "loading" });

    fetch(`/api/pms/night-availability?productId=${encodeURIComponent(productId)}&month=${monthKey}`)
      .then(
        (response) =>
          response.json() as Promise<{
            ok: boolean;
            nights?: AvailabilityRow[];
            restrictedNights?: { date: string; restrictions: LobbyNightRestrictions }[];
            reason?: string;
            retryAfterSeconds?: number | null;
          }>
      )
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          // Le mois n'est VOLONTAIREMENT pas ajouté à loadedMonthsRef : il doit rester retentable.
          setMonth({
            status: "error",
            reason: result.reason ?? "pms_unreachable",
            retryAfterSeconds: result.retryAfterSeconds ?? null,
          });
          return;
        }
        loadedMonthsRef.current.add(monthKey);
        setPmsAvailability((prev) => {
          const next = new Map(prev);
          for (const row of result.nights ?? []) next.set(row.date, row);
          return next;
        });
        // Le tableau ne porte QUE les nuits sous contrainte non nulle : vide sur tous les comptes
        // observés à ce jour, donc ce bloc est un no-op aujourd'hui — et c'est exactement pourquoi
        // le poser maintenant est sûr.
        setPmsRestrictions((prev) => {
          const next = new Map(prev);
          for (const row of result.restrictedNights ?? []) next.set(row.date, row.restrictions);
          return next;
        });
        setMonth({ status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setMonth({ status: "error", reason: "pms_unreachable", retryAfterSeconds: null });
      });

    return () => {
      cancelled = true;
    };
  }, [isPmsBacked, monthKey, productId, attempt]);

  const monthState = pmsMonths.get(monthKey);
  // `connector_inactive` est un état ANTICIPÉ (connecteur coupé côté admin), pas une panne : rien
  // ne sert de proposer de réessayer, ça ne changera pas tant qu'un admin n'a rien fait.
  const canRetry = monthState?.status === "error" && monthState.reason !== "connector_inactive";

  const effectiveAvailability = useMemo(
    () => (isPmsBacked ? [...pmsAvailability.values()] : availability),
    [isPmsBacked, pmsAvailability, availability]
  );

  const byDate = useMemo(
    () => new Map(effectiveAvailability.map((row) => [row.date, row])),
    [effectiveAvailability]
  );
  const rateByDate = useMemo(() => new Map(rates.map((row) => [row.date, row.price_cop])), [rates]);

  // Cupos déjà occupés par CE produit dans le panier en cours (pas encore en base) — même
  // raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie barrière, qui
  // reste create_order au moment du checkout). Filtré par productId, qui suffit à désambiguïser :
  // product_availability est propre à CE produit.
  const inCartByDate = useMemo(
    () =>
      buildInCartNightsMap(
        lines,
        (line) => line.productId === productId,
        (_line, night) => night
      ),
    [lines, productId]
  );

  const qtyMax = Math.max(maxQty, 1);

  // Cupos restants par nuit — une seule dérivation, lue par le barré du calendrier ET par le
  // compteur affiché dans la case. Ne dépend PAS de `qty` : c'est un fait de disponibilité, pas un
  // verdict sur la demande en cours.
  const remainingByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of effectiveAvailability) {
      map.set(row.date, row.capacity - row.booked - (inCartByDate.get(row.date) ?? 0));
    }
    return map;
  }, [effectiveAvailability, inCartByDate]);

  // Nuits que la quantité demandée ne peut pas prendre. Le seuil est `qty`, jamais 0 — c'est le
  // correctif du 2026-08-28. Avant, le calendrier ne barrait que les nuits COMPLÈTES : une nuit à 2
  // places restantes s'affichait normale, se laissait sélectionner, et n'était refusée qu'après
  // coup par range-unavailable-warning. Le verdict arrivait donc APRÈS le choix au lieu de le
  // guider, et rien ne disait quelle nuit coinçait ni combien il restait.
  const unavailableDates = useMemo(() => {
    const dates: Date[] = [];
    for (const [date, remaining] of remainingByDate) {
      if (remaining < qty) dates.push(parseISO(date));
    }
    return dates;
  }, [remainingByDate, qty]);

  // Bornes des deux marches : jamais avant aujourd'hui à Guatapé, jamais au-delà de l'horizon
  // produit (six mois, inclusif). Mêmes bornes que `startMonth`/`endMonth` et que les deux
  // matchers `before`/`after` du calendrier — une seule vérité, trois expressions.
  // `lead_days` — LE PLANCHER QUI MONTE, pas des nuits à barrer une par une (le délai de
  // réservation est une propriété de la catégorie, pas de telle ou telle nuit). On retient le
  // MAXIMUM des valeurs non nulles relevées : si deux nuits annonçaient des délais différents, le
  // plus strict est le seul qui ne propose jamais une nuit que Lobby refuserait.
  //
  // ⚠️ `null` est ignoré, pas lu comme 0 — « Lobby n'a rien dit » n'apporte aucune contrainte.
  const plancherIso = useMemo(() => {
    let lead = 0;
    for (const restrictions of pmsRestrictions.values()) {
      if (restrictions.leadDays !== null && restrictions.leadDays > lead) lead = restrictions.leadDays;
    }
    return lead > 0 ? addDaysIso(todayInBogota(), lead) : todayInBogota();
  }, [pmsRestrictions]);

  // Le même plancher, sous la forme qu'attend le matcher `before` de react-day-picker. À
  // `lead_days = 0` il vaut exactement `startOfTodayInBogota()` — d'où l'absence totale d'effet
  // aujourd'hui, sur des restrictions mesurées à {0,0,0}.
  const plancher = useMemo(() => isoDateToLocalMidnight(plancherIso), [plancherIso]);

  const bornesCalendrier = useMemo(
    () => ({ firstIso: plancherIso, lastIso: lastBookableDateIso() }),
    [plancherIso]
  );

  const ancreIso = useMemo(() => (range?.from ? format(range.from, "yyyy-MM-dd") : null), [range]);

  // LA FENÊTRE ATTEIGNABLE — correctif du 2026-08-29, cf. l'en-tête de reachableRangeWindow.
  //
  // ⚠️ L'ancre est `range.from`, y compris quand la plage est COMPLÈTE. Ce n'est pas un raccourci :
  // `addToRange` (react-day-picker) ré-étend une plage complète au reclic — un clic avant `from`
  // donne {from: clic, to}, un clic après donne {from, to: clic}. Calculer la fenêtre depuis
  // `range.from` couvre donc aussi ce reclic, sans cas particulier.
  //
  // ⚠️ Et c'est bien `range.from`, pas « from posé et to absent » : RDP 10 pose {from: X, to: X} au
  // PREMIER clic, jamais {from: X, to: undefined}. Une détection par `!range.to` ne se déclencherait
  // jamais — vérifié, c'est ce qui a fait échouer la première version de ce correctif.
  const fenetreAtteignable = useMemo(() => {
    if (!ancreIso) return null;
    return reachableRangeWindow(
      ancreIso,
      (iso) => nuitReservable(remainingByDate, iso, qty),
      bornesCalendrier,
      (arrivee) => nuitsMinimumPour(pmsRestrictions, arrivee)
    );
  // Dépendance sur `range` entier, pas sur `range?.from` : le compilateur React infère la
  // propriété la moins spécifique et refuse la mémoïsation sinon. Recalculer aussi quand seule
  // la sortie bouge est sans conséquence — la marche est bornée par l'horizon.
  }, [ancreIso, remainingByDate, qty, bornesCalendrier, pmsRestrictions]);

  // Compteur de restant dans la case du jour. Affiché UNIQUEMENT quand il contraint réellement le
  // choix (`remaining < qtyMax`) : sur un logement à 20 cupos ouverts tous les jours, imprimer
  // « 20 » sur trente cases n'informe personne et abîme la lecture du calendrier.
  //
  // Mémoïsé sur la map, et c'est indispensable : react-day-picker démonte et remonte toute la
  // grille quand le TYPE du composant `DayButton` change (cf. la doc de
  // dateTaggedDayButtonComponents dans packages/ui/src/components/legacy-calendar.tsx, qui existe
  // précisément pour ça). Recréer ce type à chaque frappe dans le champ quantité aurait défait
  // exactement l'optimisation qu'elle documente. `data-date` est repris tel quel : c'est la cible
  // stable des tests e2e, indépendante de la locale d'affichage.
  const dayButtonComponents = useMemo(() => {
    function RemainingDayButton(props: ComponentProps<typeof DayPickerCalendarDayButton>) {
      const iso = format(props.day.date, "yyyy-MM-dd");
      const remaining = remainingByDate.get(iso);
      return (
        <DayPickerCalendarDayButton {...props} data-date={iso}>
          {props.children}
          {remaining !== undefined && remaining > 0 && remaining < qtyMax ? (
            <span data-testid="night-remaining">{remaining}</span>
          ) : null}
        </DayPickerCalendarDayButton>
      );
    }
    return { DayButton: RemainingDayButton };
  }, [remainingByDate, qtyMax]);

  const nights = useMemo(() => nightsInRange(range), [range]);
  const hasUnavailableNight = hasUnavailableNightInRange(
    nights,
    qty,
    (night) => byDate.get(night),
    (night) => inCartByDate.get(night) ?? 0
  );

  const canAdd = nights.length > 0 && !hasUnavailableNight;

  // Estimation d'affichage (jamais la vraie barrière) : palier de quantité déjà résolu côté client
  // (mécanique publique, pas de secret) puis override exact par nuit si posé côté admin —
  // stay_rates (saison/week-end) volontairement ignoré ici, mêmes raisons que
  // HotelReservationForm.tsx : create_order reste la seule source de vérité du total réellement
  // facturé, cf. CartLine.priceCop.
  const estimatedUnitPriceCop = useMemo(() => {
    if (nights.length === 0) return 0;
    const tierPrice = resolveTierPrice(priceTiers, priceCop, qty);
    return estimateNightsTotal(nights, tierPrice, (night) => rateByDate.get(night));
  }, [nights, qty, priceTiers, priceCop, rateByDate]);

  // La quantité N'EST PLUS remise à 1 ici. Elle l'était à chaque clic sur le calendrier, ce qui
  // rendait impossible le seul geste qui compte : poser d'abord le nombre de places, puis regarder
  // quelles nuits l'acceptent. Le champ est désormais saisissable AVANT les dates, et sa valeur
  // survit à la sélection.
  function handleSelectRange(next: DateRange | undefined) {
    setRange(next);
    setJustAdded(false);
  }

  // Monter la quantité peut invalider une plage DÉJÀ posée, sans qu'aucun clic n'ait eu lieu sur
  // le calendrier — c'est le seul chemin restant par lequel `hasUnavailableNightInRange` pourrait
  // encore parler. On replie plutôt que d'avertir : la fenêtre resserrée est visible à l'écran
  // dans le même geste, et l'utilisateur repique une sortie dedans.
  function handleQtyChange(value: string) {
    const brut = Number(value);
    const suivant = Number.isNaN(brut) ? 1 : Math.min(Math.max(brut, 1), qtyMax);
    setQty(suivant);
    if (!range?.from) return;

    const fenetre = reachableRangeWindow(
      format(range.from, "yyyy-MM-dd"),
      (iso) => nuitReservable(remainingByDate, iso, suivant),
      bornesCalendrier,
      (arrivee) => nuitsMinimumPour(pmsRestrictions, arrivee)
    );
    // La nuit d'arrivée elle-même ne tient plus la quantité : il n'y a plus de fenêtre à rétrécir,
    // on repart d'une sélection vide.
    if (!fenetre) {
      setRange(undefined);
      return;
    }
    // La sortie déborde la nouvelle fenêtre : on replie sur l'arrivée, qui redevient l'ancre.
    if (range.to && format(range.to, "yyyy-MM-dd") > fenetre.toIso) {
      setRange({ from: range.from, to: range.from });
    }
  }

  function handleAddToCart() {
    if (!range?.from || !range?.to || !canAdd) return;
    addLine({
      productId,
      productName,
      establishmentName,
      date: format(range.from, "yyyy-MM-dd"),
      endDate: format(range.to, "yyyy-MM-dd"),
      qty,
      priceCop: estimatedUnitPriceCop,
    });
    setJustAdded(true);
    setRange(undefined);
    setQty(1);
  }

  // Nommer l'unité de `qty` là où elle se saisit. « Cantidad » ne disait pas de QUOI, alors que la
  // réponse dépend du produit : un dortoir se vend au lit, une privée ou une maison à l'unité (même
  // règle que cuposPerUnit et que le garde-fou capacity_exceeds_physical). `lodging_kind` étant
  // facultatif, l'intitulé neutre reste le repli.
  const quantityLabel =
    lodgingKind === "dorm"
      ? t("quantityLabelBeds")
      : lodgingKind === "private"
        ? t("quantityLabelRooms")
        : lodgingKind === "whole_house"
          ? t("quantityLabelHouses")
          : t("quantityLabel");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("availabilityTitle")}</h2>
        {monthState?.status === "error" ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm text-danger" role="alert" data-testid="pms-availability-error">
              {monthState.reason === "pms_rate_limited"
                ? t("pmsAvailabilityRateLimited")
                : t("pmsAvailabilityError")}
            </p>
            {canRetry ? (
              <Button
                size="sm"
                variant="secondary"
                data-testid="pms-availability-retry"
                onPress={() => setAttempt((value) => value + 1)}
              >
                {t("pmsAvailabilityRetry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {monthState?.status === "loading" ? (
          <p className="mb-2 text-sm text-muted" aria-live="polite" data-testid="pms-availability-loading">
            {t("pmsAvailabilityLoading")}
          </p>
        ) : null}
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelectRange}
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          // La NAVIGATION elle-même est bornée, pas seulement la sélection : `visibleMonth` pilote
          // la clé du fetch, et la route refuse en 400 `month_out_of_range` tout mois hors horizon.
          // Sans ces deux bornes, paginer au septième mois affichait une erreur de disponibilité
          // pour ce qui n'est en réalité qu'une limite de vente.
          startMonth={startOfTodayInBogota()}
          endMonth={dernierJourReservable}
          // Le jour « aujourd'hui » mis en avant par react-day-picker vient sinon de son propre
          // `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167), donc du NAVIGATEUR.
          // Sans cette prop, le correctif de `disabled` ci-dessous et le surlignage se
          // contrediraient pour un visiteur hors Colombie : le 27 resterait cliquable mais le 28
          // serait peint comme « aujourd'hui ».
          today={startOfTodayInBogota()}
          // SYMÉTRIE AFFICHAGE / VERDICT, corrigée le 2026-08-28. `hasUnavailableNightInRange`
          // traite depuis toujours une nuit ABSENTE comme indisponible ; l'affichage, lui, ne
          // regardait que les nuits REÇUES — une nuit jamais résolue s'affichait donc normale et
          // cliquable, et n'était refusée qu'après la sélection. La règle existait déjà une porte à
          // côté, dans ReservationForm : on la reprend, on ne l'invente pas. Vaut aussi pour le
          // chemin non-PMS, où le même trou existait sans que personne ne l'ait vu.
          disabled={[
            // Minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) : un visiteur
            // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
            // précédent barré, alors qu'à Guatapé il était encore réservable.
            { before: plancher },
            // Borne HAUTE : au-delà de l'horizon produit, rien n'est vendable. Sans elle, ces
            // dates paraissaient sélectionnables et n'étaient refusées qu'après coup.
            { after: dernierJourReservable },
            (date) => {
              const iso = format(date, "yyyy-MM-dd");
              // PHASE 2 — une arrivée est posée. Seule la fenêtre atteignable reste cliquable, et
              // la première nuit bloquante y figure comme date de SORTIE (on dort jusqu'à la
              // veille). C'est ce qui empêche d'ENJAMBER une nuit pleine, au lieu de le reprocher
              // après coup : `hasUnavailableNightInRange` n'a plus l'occasion de parler.
              if (fenetreAtteignable && ancreIso) {
                if (iso === ancreIso) return false; // recliquer l'ancre reste permis (ré-ancrage)
                if (iso < fenetreAtteignable.fromIso || iso > fenetreAtteignable.toIso) return true;
                // `min_stay` — la borne BASSE. Une sortie trop proche de l'arrivée ne fait pas un
                // séjour assez long : elle n'est pas signalée, elle n'est pas sélectionnable.
                if (iso > ancreIso) {
                  const sortie = fenetreAtteignable.earliestCheckOutIso;
                  return sortie === null || iso < sortie;
                }
                const arrivee = fenetreAtteignable.latestCheckInIso;
                return arrivee === null || iso > arrivee;
              }
              // PHASE 1 — pas encore d'arrivée. On demande à la MÊME fonction si un séjour valide
              // peut partir d'ici, plutôt que de réécrire la règle : ça couvre la nuit SANS DONNÉE
              // (acquis du 2026-08-28), la nuit PLEINE (2026-08-29), et désormais l'arrivée d'où
              // aucun séjour d'au moins `min_stay` nuits ne tient dans la fenêtre.
              const depuisIci = reachableRangeWindow(
                iso,
                (nuit) => nuitReservable(remainingByDate, nuit, qty),
                bornesCalendrier,
                (arrivee) => nuitsMinimumPour(pmsRestrictions, arrivee)
              );
              return depuisIci === null || depuisIci.earliestCheckOutIso === null;
            },
          ]}
          modifiers={{ unavailable: unavailableDates }}
          modifiersClassNames={{ unavailable: "line-through opacity-60" }}
          components={dayButtonComponents}
        />
      </div>

      {nights.length > 0 ? (
        hasUnavailableNight ? (
          <p className="text-sm text-danger" role="alert" data-testid="range-unavailable-warning">
            {t("rangeUnavailable")}
          </p>
        ) : (
          <p className="text-sm text-muted" aria-live="polite">
            {t("nightsCount", { count: nights.length })}
          </p>
        )
      ) : (
        <p className="text-sm text-muted">{t("selectRange")}</p>
      )}

      {/* Plus de `isDisabled` : le champ se saisit avant les dates, c'est tout l'intérêt du
          correctif — le calendrier se barre au fur et à mesure qu'on monte la quantité. */}
      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        onChange={handleQtyChange}
      >
        <Label>{quantityLabel}</Label>
        <Input id="qty" type="number" min={1} max={qtyMax} data-testid="lodging-qty-input" />
      </TextField>

      {canAdd ? (
        <p className="text-sm font-medium" data-testid="lodging-estimated-price">
          {t("estimatedTotal")}: {formatCop(estimatedUnitPriceCop * qty)}
        </p>
      ) : null}

      {justAdded ? (
        <p role="status" data-testid="added-to-cart" className="text-sm font-medium text-accent">
          {t("addedToCart")}{" "}
          <Link href="/checkout" className="underline" data-testid="go-to-checkout-link">
            {t("goToCheckout")}
          </Link>
        </p>
      ) : null}

      <Button data-testid="add-to-cart-button" onPress={handleAddToCart} isDisabled={!canAdd}>
        {t("addToCart")}
      </Button>
    </div>
  );
}
