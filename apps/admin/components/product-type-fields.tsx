"use client";

import { useEffect, useRef } from "react";
import type { TransportInfoFields } from "@/lib/products/transportInfo";
import { ProgramEditor } from "@/components/program-editor";
import { Checkbox, Input, Label, ListBox, Select, Switch, TextField } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { LobbyOptionPicker, type LobbyRoomOption } from "@/components/lobby-option-picker";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { StayRatesEditor } from "@/components/stay-rates-editor";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";
import { LODGING_KINDS, LODGING_UNITS, type LodgingKind, type LodgingUnit } from "@hifago/domain";
import { LODGING_KIND_LABELS } from "@/lib/products/lodgingKindLabels";
import { LODGING_UNIT_LABELS } from "@/lib/products/lodgingUnitLabels";

// apps/admin n'est pas localisé (hifago/CLAUDE.md §2 point 1) — locale "es" fixe, même convention
// que tout le reste de ce formulaire (labels en dur, pas de next-intl).
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es", { weekday: "long" });

// Le sentinel « none » existe parce que products.lodging_kind est facultative et que react-aria ne
// sait pas représenter « aucune option » avec une clé vide. Les libellés, eux, sont partagés avec
// l'écran de modération (lib/products/lodgingKindLabels.ts) — jamais redéclarés ici.
const LODGING_KIND_NONE = "none";

// Confirme sur quel jour de semaine tombe la première occurrence d'un evento récurrent — sans ça,
// "cada 14 días" ne dit jamais si c'est un mardi ou un jeudi (gap réel signalé par Jérôme,
// 2026-08-18). Le jour de semaine n'est mathématiquement garanti stable d'une occurrence à l'autre
// que si la fréquence est un multiple de 7 (sinon la récurrence glisse de jour en jour) — dans ce
// cas seulement, le texte précise explicitement "se repetirá cada {jour}".
function occurrenceWeekdayHint(occurrenceDate: string, recurrenceFrequencyDays: string): string {
  const weekday = WEEKDAY_FORMATTER.format(new Date(`${occurrenceDate}T00:00:00`));
  const days = Number(recurrenceFrequencyDays);
  if (Number.isInteger(days) && days > 0 && days % 7 === 0) {
    const weeks = days / 7;
    return `Cae en ${weekday} — se repetirá cada ${weekday} (cada ${weeks === 1 ? "semana" : `${weeks} semanas`}).`;
  }
  return `Cae en ${weekday}.`;
}

// Refonte parcours produit ↔ LobbyPMS (2026-08-26) — libellé du sélecteur Lobby par type concret
// ("esta actividad"/"este transporte"/"este alojamiento"), jamais une "vinculación" abstraite
// (retour Jérôme : le choix doit parler de la chose créée). Evento/Campamento/Hotel n'entrent
// jamais dans cette table — le bloc qui la consomme ne se rend pas pour ces types (cf. décision E
// du plan LobbyPMS : evento ne produit jamais d'order_line, camp est incompatible avec le payload
// {productId, qty} sans date d'addLobbyProductService, hotel n'a pas de prix propre).
const LOBBY_LINK_COPY: Partial<Record<ProductType, { question: string; noneLabel: string; pickerLabel: string }>> = {
  lodging: {
    question: "¿Cómo cargar este alojamiento?",
    noneLabel: "Alojamiento clásico",
    pickerLabel: "Habitación vinculada a una categoría de LobbyPMS",
  },
  activity: {
    question: "¿Cómo cargar esta actividad?",
    noneLabel: "Actividad clásica",
    pickerLabel: "Actividad vinculada a un servicio de LobbyPMS",
  },
  transport: {
    question: "¿Cómo cargar este transporte?",
    noneLabel: "Transporte clásico",
    pickerLabel: "Transporte vinculado a un servicio de LobbyPMS",
  },
};

// Extrait de ProductForm (spec 15) — regroupe tous les champs dont la présence dépend du `type` de
// produit (hasLocationAndTags/hasPriceQtyFields/hasCheckInOut + les blocs propres à chaque type),
// PAS le nom/description/établissement/type/photos ni le bouton de soumission (ceux-là restent
// spécifiques à chaque contexte appelant — ProductForm en gère certains différemment selon
// isEditing/variant, ModerateProductCreationProposalForm ne les affiche pas de la même façon).
// Composant purement contrôlé (state vient de useProductTypeFieldsState, jamais possédé ici) — deux
// consommateurs aujourd'hui : ProductForm (variants admin ET socio-proposal) et
// ModerateProductCreationProposalForm, un seul endroit à faire évoluer pour tout futur changement
// de gating par type (cf. décision Jérôme 2026-08-17, "extraire plutôt que dupliquer").
export function ProductTypeFields({
  type,
  state,
  showTags,
  showSlotRulesEditor,
  allowCreateTags,
  availableTags,
  showAmenities,
  availableAmenities,
  establishmentId,
  establishmentLobbyConnected,
  allowManualLobbyEntry,
  onApplyLobbyRoomData,
  lobbyLinkReadOnly = false,
  allowOnlineBookableConfig = false,
  campDurationDays = null,
}: {
  type: ProductType;
  state: ProductTypeFieldsState;
  // showTags/showSlotRulesEditor : réplique exacte du gating "création
  // seulement" déjà en place dans ProductForm (spec 11 : "délégués en édition à des blocs
  // séparés") — décidé par l'appelant (ProductForm passe `!isEditing`), pas recalculé ici.
  // address/lat/lon/prix/tramos/min-max/check-in-out/capacité/stay_rates restent, eux, affichés
  // dans les deux modes, donc jamais gatés par ces props.
  showTags?: boolean;
  showSlotRulesEditor?: boolean;
  allowCreateTags?: boolean;
  availableTags?: TagOption[];
  // Équipements structurés (migration 20260917110000) — MÊME gating "création seulement" que
  // showTags, mais admin-only en plus (jamais passé `true` par le variant socio-proposal ni par
  // ModerateProductCreationProposalForm) : ces deux consommateurs omettent la prop, qui reste
  // `undefined`/falsy, le bloc ne se rend donc jamais pour eux — les équipements restent un geste
  // admin post-création par défaut (ProductAmenitiesBlock en édition), staged ici seulement pour la
  // création ADMIN directe (cf. product-form.tsx).
  showAmenities?: boolean;
  availableAmenities?: TagOption[];
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — remplace l'ancien showLobbyFields
  // (booléen unique, admin-only). establishmentLobbyConnected (dérivé de
  // lobby_connector_active && lobby_has_token côté appelant) contrôle si le bloc s'affiche DU TOUT
  // (admin ET socio, dès que l'établissement est connecté) ; allowManualLobbyEntry
  // (`variant === "admin"`) contrôle si l'option "Entrada manual" (ID tapé à la main) est proposée
  // — jamais au socio, pour préserver l'invariant qui empêche d'injecter un ID Lobby arbitraire.
  // Durée PERSISTÉE du camp (spec 37), pour que l'éditeur de programme ouvre le bon nombre de
  // journées en ÉDITION — où l'input « Duración (días) » reste volontairement vierge (gap
  // création-only, cf. le commentaire du select dans admin/products/[id]/edit/page.tsx). En
  // création, la valeur saisie dans le formulaire prime sur cette prop. Elle n'alimente QUE
  // l'éditeur de programme : la réinjecter dans l'input afficherait une valeur que l'update
  // n'écrit pas.
  campDurationDays?: number | null;
  establishmentId?: string;
  establishmentLobbyConnected?: boolean;
  allowManualLobbyEntry?: boolean;
  // Arbitrage Jérôme du 2026-08-26 (« import à la liaison ») — fourni uniquement par les écrans qui
  // détiennent réellement le nom et la description du produit (ProductForm). Absent → le bouton
  // « Usar estos datos » ne s'affiche pas, plutôt qu'un bouton sans effet.
  // Asynchrone depuis le 2026-08-26 : le handler réel importe aussi les photos, et le picker
  // l'`await` pour afficher « Importando… ». Le type le disait synchrone — TypeScript l'acceptait
  // (bivariance du retour void), mais le seul fichier qu'on ouvre pour comprendre le câblage
  // affirmait l'inverse de ce qui se passe.
  onApplyLobbyRoomData?: (data: LobbyRoomOption) => void | Promise<void>;
  // Arbitrage Jérôme du 2026-08-26 : le socio VOIT le lien, ne le modifie pas (cf. le commentaire
  // de `readOnly` dans lobby-option-picker.tsx).
  lobbyLinkReadOnly?: boolean;
  // Evento réservable en ligne (2026-09-15) — décision produit « admin uniquement » : un socio ne
  // doit jamais pouvoir rendre un evento réservable-payant via le circuit de proposition. Même
  // patron que `allowManualLobbyEntry` (`variant === "admin"`, jamais passé par les 3 consommateurs
  // socio/modération). Le blocage réel vit côté RPC (whitelist de `submit_product_creation_proposal`/
  // `create_product_from_proposal`, qui ignorent silencieusement ces 5 colonnes) — cette prop
  // n'est qu'une défense en profondeur côté écran, pas le vrai rempart.
  allowOnlineBookableConfig?: boolean;
}) {
  const {
    isEvento, isCamp, isActivity, isLodging, isTransport,
    hasLocationAndTags, hasTags, hasAmenities, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity, hasGroupDiscount,
    hasProgram,
  } = productTypeGating(type);

  // Le vrai discriminant des champs evento : configurable ICI (admin) ET effectivement basculé.
  // Nommé une fois plutôt que réécrit deux fois — dont une NIÉE plus bas pour le libellé de prix
  // vitrine, où la négation d'une conjonction recopiée est la façon la plus discrète de faire
  // apparaître les deux blocs à la fois.
  const eventoReservableEnLinea = allowOnlineBookableConfig && state.onlineBookable;

  // Le déclencheur est "une valeur existe", pas "quel mode du sélecteur est actif" — vrai que l'ID
  // vienne du picker ou d'une saisie admin manuelle. Reste correct depuis que le mode par défaut
  // en édition est passé de "manual" à "picker" (cf. useProductTypeFieldsState), justement parce
  // qu'il ne dépend pas du mode.
  const isRoomLinkedToLobby = isLodging && Boolean(state.lobbyCategoryId.trim());
  const lobbyValue = (isLodging ? state.lobbyCategoryId : state.lobbyProductId).trim();
  const lobbyLinkCopy = LOBBY_LINK_COPY[type];

  const addressSearchRef = useRef<HTMLDivElement | null>(null);
  // Transport (2026-09-16) : DEUX widgets de plus, un par extrémité du trajet.
  // ⚠️ TROIS refs et TROIS effets distincts, jamais un seul mutualisé. Deux raisons, et les deux
  // sont des bugs silencieux :
  //  1. un ref unique serait écrasé par le dernier `<div ref>` rendu, donc un widget se monterait
  //     dans le mauvais conteneur ;
  //  2. un effet unique keyé sur `[hasLocationAndTags]` NE SE RELANCERAIT PAS en basculant le
  //     sélecteur Tipo d'`activity` à `transport` — la valeur du booléen ne change pas de `false` à
  //     `true`, elle passe de `true` à `false` sans que l'autre condition soit observée. Les
  //     conteneurs de départ/arrivée apparaîtraient dans le DOM et ne recevraient JAMAIS de widget,
  //     sans la moindre erreur. Chaque effet garde donc sa propre condition dans ses dépendances.
  const departureSearchRef = useRef<HTMLDivElement | null>(null);
  const arrivalSearchRef = useRef<HTMLDivElement | null>(null);

  // Forme FONCTIONNELLE du setter (`(prev) => …`), pas `{ ...state.transportInfo, … }` : le
  // callback du widget Google arrive de façon asynchrone, longtemps après le render qui l'a monté,
  // et fermerait sinon sur un `transportInfo` périmé.
  const setTransport = (patch: Partial<TransportInfoFields>) =>
    state.setTransportInfo((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isTransport) return;
    const container = departureSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(
      container,
      (place) => {
        setTransport({
          departureAddress: place.address,
          ...(place.lat !== null && place.lon !== null
            ? { departureLat: String(place.lat), departureLon: String(place.lon) }
            : {}),
        });
      },
      {
        testId: "departure-address-autocomplete",
        ariaLabel: "Lugar de salida",
        placeholder: "Empieza a escribir el lugar de salida…",
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state est un objet stable de setters, jamais recréé entre renders utiles
  }, [isTransport]);

  useEffect(() => {
    if (!isTransport) return;
    const container = arrivalSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(
      container,
      (place) => {
        setTransport({
          arrivalAddress: place.address,
          ...(place.lat !== null && place.lon !== null
            ? { arrivalLat: String(place.lat), arrivalLon: String(place.lon) }
            : {}),
        });
      },
      {
        testId: "arrival-address-autocomplete",
        ariaLabel: "Lugar de llegada",
        placeholder: "Empieza a escribir el lugar de llegada…",
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idem : seuls des setters sont capturés
  }, [isTransport]);

  useEffect(() => {
    if (!hasLocationAndTags) return;
    const container = addressSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, (place) => {
      state.setAddress(place.address);
      if (place.lat !== null && place.lon !== null) {
        state.setLat(String(place.lat));
        state.setLon(String(place.lon));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state est un objet stable de setters, jamais recréé entre renders utiles
  }, [hasLocationAndTags]);

  return (
    <>
      {/* Refonte parcours partenaire ↔ LobbyPMS (2026-08-25, réordonnée sur retour Jérôme le même
          jour — "la page, je te dis de la changer en haut") — ce choix vient EN PREMIER, avant
          adresse/prix/etc. : c'est une bifurcation structurante (Lobby vs saisie propre), pas un
          détail à découvrir en scrollant. lobby_category_id (alojamiento) et lobby_product_id
          (activité reflétée) vivent tous deux sur `products`, mais s'appliquent à des TYPES
          distincts et mutuellement exclusifs (isPmsBacked = lodging + lobby_category_id ; miroir
          d'activité = activity + lobby_product_id, cf. packages/domain/src/pms/isPmsBacked.ts et
          apps/web/app/api/pms/reserve-nights/route.ts). Affiché uniquement si l'établissement est
          connecté à Lobby — jamais un champ vide sans contexte pour un établissement non connecté. */}
      {(isLodging || isActivity || isTransport) && establishmentLobbyConnected && lobbyLinkCopy ? (
        <div className="flex flex-col gap-2">
          {lobbyLinkReadOnly ? (
            // Lecture seule : ni sélecteur de mode, ni saisie. Si aucun lien n'existe, on n'affiche
            // rien du tout plutôt qu'un bloc vide sans action possible.
            lobbyValue ? (
              <>
                <Label>{lobbyLinkCopy.pickerLabel}</Label>
                <LobbyOptionPicker
                  establishmentId={establishmentId ?? ""}
                  kind={isLodging ? "rooms" : "services"}
                  value={lobbyValue}
                  onChange={() => {}}
                  testId={isLodging ? "lobby-category-id-picker" : "lobby-product-id-picker"}
                  readOnly
                />
              </>
            ) : null
          ) : (
          <>
          <Select
            fullWidth
            value={state.lobbyLinkMode}
            onChange={(newMode) => {
              if (!newMode) return;
              state.setLobbyLinkMode(newMode as "none" | "picker" | "manual");
              if (newMode === "none") {
                if (isLodging) state.setLobbyCategoryId("");
                if (isActivity || isTransport) state.setLobbyProductId("");
              }
            }}
          >
            <Label>{lobbyLinkCopy.question}</Label>
            <Select.Trigger data-testid="lobby-link-mode-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="none" textValue={lobbyLinkCopy.noneLabel}>
                  {lobbyLinkCopy.noneLabel}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="picker" textValue={lobbyLinkCopy.pickerLabel}>
                  {lobbyLinkCopy.pickerLabel}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {allowManualLobbyEntry ? (
                  <ListBox.Item id="manual" textValue="Entrada manual (ID)">
                    Entrada manual (ID)
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ) : null}
              </ListBox>
            </Select.Popover>
          </Select>

          {state.lobbyLinkMode === "picker" && establishmentId ? (
            isLodging ? (
              <LobbyOptionPicker
                establishmentId={establishmentId}
                kind="rooms"
                value={state.lobbyCategoryId}
                onChange={state.setLobbyCategoryId}
                testId="lobby-category-id-picker"
                onApplyRoomData={onApplyLobbyRoomData}
              />
            ) : (
              <LobbyOptionPicker
                establishmentId={establishmentId}
                kind="services"
                value={state.lobbyProductId}
                onChange={state.setLobbyProductId}
                testId="lobby-product-id-picker"
              />
            )
          ) : null}

          {state.lobbyLinkMode === "manual" && allowManualLobbyEntry ? (
            isLodging ? (
              <TextField fullWidth name="lobby-category-id" value={state.lobbyCategoryId} onChange={state.setLobbyCategoryId}>
                <Label>LobbyPMS category_id</Label>
                <Input type="number" min={1} data-testid="lobby-category-id-input" />
              </TextField>
            ) : (
              <TextField fullWidth name="lobby-product-id" value={state.lobbyProductId} onChange={state.setLobbyProductId}>
                <Label>LobbyPMS product_id (servicio reflejado en el establecimiento PMS)</Label>
                <Input type="number" min={1} data-testid="lobby-product-id-input" />
              </TextField>
            )
          ) : null}

          </>
          )}

          {/* Réécrite le 2026-08-26 avec l'arbitrage « import à la liaison ». L'ancienne version
              affirmait que capacité/description/photos « se gestionan allí, no aquí » alors
              qu'aucun code ne les lisait chez Lobby : les champs étaient masqués ET vides, donc la
              fiche publique d'une chambre PMS-backed était un nom nu. Ne jamais rétablir une des
              deux moitiés sans l'autre — un bloc photos rendu sous une phrase qui dit le contraire
              est pire que les deux états cohérents. */}
          {isRoomLinkedToLobby ? (
            <p className="text-xs text-muted" data-testid="lobby-room-managed-fields-note">
              LobbyPMS gestiona la disponibilidad de esta habitación. El nombre, la descripción, la
              capacidad y las fotos se copian desde allí al vincular y luego se editan aquí.
            </p>
          ) : null}
        </div>
      ) : null}

      {hasLocationAndTags ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address-search">Buscar dirección (Google) — opcional</Label>
            <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={state.address}
              onChange={(event) => state.setAddress(event.target.value)}
              placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
              data-testid="address-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lat">Latitud — detectada o manual</Label>
              <Input id="lat" value={state.lat} onChange={(event) => state.setLat(event.target.value)} data-testid="lat-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lon">Longitud — detectada o manual</Label>
              <Input id="lon" value={state.lon} onChange={(event) => state.setLon(event.target.value)} data-testid="lon-input" />
            </div>
          </div>
        </>
      ) : null}

      {/* TRANSPORT — horaires et lieux, PUREMENT INFORMATIFS (migration 20260916150000, demande
          Jérôme du 2026-09-16 : « c'est à titre informatif pour la personne qui réserve »).
          Ce qu'on sort du code en faisant ça : le texte figé `transport_info_html` du portail
          legacy (`public/reservar.js:176` du dépôt parent), que personne ne pouvait modifier sans
          déployer.
          ⚠️ La fenêtre de départs n'est PAS un créneau réservable : aucun `product_slot_rules` ici,
          cette table-là rendrait `create_order` bloquant (refus `slot_required`). Un transport
          reste réservé par DATE, et son cupo réel est « Cupo diario por defecto » plus bas.
          Le lieu de départ vit dans `transport_departure_*`, pas dans le trio générique
          `address`/`lat`/`lon` (retiré d'`hasLocationAndTags` pour ce type) : un trajet a DEUX
          extrémités, et une seule convention de nommage doit porter un seul concept. */}
      {isTransport ? (
        <>
          {/* LE CONTACT, en premier : c'est par là que le voyageur réserve un trajet. Un transport
              n'a plus de calendrier ni de panier (décision Jérôme du 2026-09-17) — sa fiche publique
              affiche un bouton WhatsApp à la place. Champ OPTIONNEL : vide, c'est le WhatsApp de
              Hifago qui répond, jamais un bouton mort. */}
          <div className="flex flex-col gap-1.5">
            <TextField
              fullWidth
              name="transport-contact-phone"
              value={state.transportInfo.contactPhone}
              onChange={(value) => setTransport({ contactPhone: value })}
            >
              <Label>Teléfono de contacto (WhatsApp) — opcional</Label>
              <Input
                type="tel"
                placeholder="+573001112233"
                data-testid="transport-contact-phone-input"
              />
            </TextField>
            <p className="text-xs text-muted" data-testid="transport-contact-phone-help">
              Formato internacional, con el indicativo del país. Si lo dejas vacío, la ficha pública
              muestra el WhatsApp de Hifago. Un transporte no se reserva en línea: el viajero
              escribe por WhatsApp.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="departure-address-search">Lugar de salida — buscar (Google), opcional</Label>
            <div id="departure-address-search" ref={departureSearchRef} data-testid="departure-address-search" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="departure-address">Lugar de salida</Label>
            <Input
              id="departure-address"
              value={state.transportInfo.departureAddress}
              onChange={(event) => setTransport({ departureAddress: event.target.value })}
              placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
              data-testid="departure-address-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="departure-lat">Latitud de salida — detectada o manual</Label>
              <Input
                id="departure-lat"
                value={state.transportInfo.departureLat}
                onChange={(event) => setTransport({ departureLat: event.target.value })}
                data-testid="departure-lat-input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="departure-lon">Longitud de salida — detectada o manual</Label>
              <Input
                id="departure-lon"
                value={state.transportInfo.departureLon}
                onChange={(event) => setTransport({ departureLon: event.target.value })}
                data-testid="departure-lon-input"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arrival-address-search">Lugar de llegada — buscar (Google), opcional</Label>
            <div id="arrival-address-search" ref={arrivalSearchRef} data-testid="arrival-address-search" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arrival-address">Lugar de llegada</Label>
            <Input
              id="arrival-address"
              value={state.transportInfo.arrivalAddress}
              onChange={(event) => setTransport({ arrivalAddress: event.target.value })}
              placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
              data-testid="arrival-address-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="arrival-lat">Latitud de llegada — detectada o manual</Label>
              <Input
                id="arrival-lat"
                value={state.transportInfo.arrivalLat}
                onChange={(event) => setTransport({ arrivalLat: event.target.value })}
                data-testid="arrival-lat-input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="arrival-lon">Longitud de llegada — detectada o manual</Label>
              <Input
                id="arrival-lon"
                value={state.transportInfo.arrivalLon}
                onChange={(event) => setTransport({ arrivalLon: event.target.value })}
                data-testid="arrival-lon-input"
              />
            </div>
          </div>

          {/* `first = last` est VALIDE, et c'est le cas normal d'un transfert à heure fixe — d'où le
              `>=` du CHECK products_transport_departure_order, divergence assumée avec
              product_slot_rules_time_order (qui exige, lui, un intervalle strict). */}
          <div className="grid grid-cols-2 gap-4">
            <TextField
              fullWidth
              name="transport-first-departure"
              value={state.transportInfo.firstDepartureTime}
              onChange={(value) => setTransport({ firstDepartureTime: value })}
            >
              <Label>Primera salida — opcional</Label>
              <Input type="time" data-testid="transport-first-departure-input" />
            </TextField>
            <TextField
              fullWidth
              name="transport-last-departure"
              value={state.transportInfo.lastDepartureTime}
              onChange={(value) => setTransport({ lastDepartureTime: value })}
            >
              <Label>Última salida — opcional</Label>
              <Input type="time" data-testid="transport-last-departure-input" />
            </TextField>
          </div>
          <div className="flex flex-col gap-1.5">
            <TextField
              fullWidth
              name="transport-seats"
              value={state.transportInfo.seatsPerDeparture}
              onChange={(value) => setTransport({ seatsPerDeparture: value })}
            >
              <Label>Plazas por salida — opcional</Label>
              <Input type="number" min={1} data-testid="transport-seats-input" />
            </TextField>
            <p className="text-xs text-muted" data-testid="transport-seats-help">
              Solo informativo: se muestra en la ficha pública y nunca bloquea una reserva. El cupo
              que sí bloquea es «Cupo diario por defecto» más abajo.
            </p>
          </div>
        </>
      ) : null}

      {showTags && hasTags ? (
        <TagsMultiSelect
          availableTags={availableTags ?? []}
          selectedTagIds={state.selectedTagIds}
          onChange={state.setSelectedTagIds}
          allowCreate={allowCreateTags}
          testId="tags-multiselect"
        />
      ) : null}

      {showAmenities && hasAmenities ? (
        <TagsMultiSelect
          availableTags={availableAmenities ?? []}
          selectedTagIds={state.selectedAmenityIds}
          onChange={state.setSelectedAmenityIds}
          allowCreate={false}
          label="Equipamiento"
          placeholder="Buscar equipamiento…"
          emptyMessage="Ningún equipamiento disponible."
          testId="amenities-multiselect"
        />
      ) : null}

      {!isEvento && !hasLocationAndTags ? (
        // `isRequired` suit EXACTEMENT la contrainte SQL `products_price_cop_required_unless_vitrine` :
        // un evento OU une URL externe dispensent du prix chiffré. Sans ça, le champ resterait
        // obligatoire à l'écran alors que la base l'accepte vide — l'admin ne pourrait pas créer la
        // vitrine que la migration du 2026-09-08 autorise (spec 30 §6a).
        <TextField
          fullWidth
          name="price"
          value={state.priceCop}
          onChange={state.setPriceCop}
          isRequired={!state.externalBookingUrl.trim()}
        >
          <Label>Precio (COP)</Label>
          <Input id="price" type="number" min={1} />
        </TextField>
      ) : null}

      {hasPriceQtyFields ? (
        <div className="flex flex-col gap-2">
          <PriceTiersEditor
            priceMode={state.priceMode}
            onPriceModeChange={state.setPriceMode}
            priceCop={state.priceCop}
            onPriceCopChange={state.setPriceCop}
            priceTiers={state.priceTiers}
            onPriceTiersChange={state.setPriceTiers}
            testId={(part, tierIndex) => {
              switch (part) {
                case "toggle":
                  return "price-mode-toggle";
                case "simple-input":
                  return "price-input";
                case "tiers-editor":
                  return "price-tiers-editor";
                case "add-tier":
                  return "add-price-tier-button";
                case "tier-min":
                  return `price-tier-min-${tierIndex}`;
                case "tier-max":
                  return `price-tier-max-${tierIndex}`;
                case "tier-price":
                  return `price-tier-price-${tierIndex}`;
                case "remove-tier":
                  return `remove-price-tier-${tierIndex}`;
              }
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField value={state.minQty} onChange={state.setMinQty}>
              <Label>{isLodging ? "Huéspedes mínimos — opcional" : "Cantidad mínima — opcional"}</Label>
              <Input type="number" min={1} data-testid="min-qty-input" />
            </TextField>
            <TextField value={state.maxQty} onChange={state.setMaxQty}>
              <Label>{isLodging ? "Huéspedes máximos — opcional" : "Cantidad máxima — opcional"}</Label>
              <Input type="number" min={1} data-testid="max-qty-input" />
            </TextField>
          </div>
        </div>
      ) : null}

      {hasDefaultCapacity ? (
        <div className="flex flex-col gap-1.5">
          <TextField fullWidth name="default-capacity" value={state.defaultCapacity} onChange={state.setDefaultCapacity}>
            <Label>Cupo diario por defecto — opcional</Label>
            <Input type="number" min={1} data-testid="default-capacity-input" />
          </TextField>
          <p className="text-xs text-muted" data-testid="default-capacity-help">
            Cuántas unidades hay disponibles cada día por defecto (antes de excepciones en el
            calendario). No es lo mismo que Cantidad mínima/máxima, que solo limita cuánto puede
            pedir un cliente en una sola reserva.
          </p>
        </div>
      ) : null}

      {hasGroupDiscount ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-4">
            <TextField
              fullWidth
              name="group-discount-threshold-qty"
              value={state.groupDiscount.thresholdQty}
              onChange={(value) => state.setGroupDiscount({ ...state.groupDiscount, thresholdQty: value })}
            >
              <Label>Descuento por grupo — a partir de (personas) — opcional</Label>
              <Input type="number" min={1} data-testid="group-discount-threshold-qty-input" />
            </TextField>
            <TextField
              fullWidth
              name="group-discount-pct"
              value={state.groupDiscount.pct}
              onChange={(value) => state.setGroupDiscount({ ...state.groupDiscount, pct: value })}
            >
              <Label>Porcentaje de descuento — opcional</Label>
              <Input type="number" min={1} max={99} data-testid="group-discount-pct-input" />
            </TextField>
          </div>
          <p className="text-xs text-muted" data-testid="group-discount-help">
            Si el total de personas ya inscritas en esta salida (todas las reservas juntas) alcanza
            este umbral, el precio de esa reserva y de las siguientes baja el porcentaje indicado.
            Distinto de los tramos de precio: esto depende de cuánta gente se anota en total, no de
            la cantidad de UNA sola reserva. Completa los dos campos juntos, o deja ambos vacíos.
          </p>
        </div>
      ) : null}

      {/* 2 colonnes dans tous les cas : un hôtel n'a que check-in/check-out, un alojamiento
          complète la 2e ligne avec capacité + cantidad (ajoutée le 2026-08-26). Une grille de 4
          colonnes serait illisible sur un écran étroit. */}
      {hasCheckInOut ? (
        <div className="grid grid-cols-2 gap-4">
          <TextField fullWidth name="check-in" value={state.checkInTime} onChange={state.setCheckInTime}>
            <Label>Check-in — opcional</Label>
            <Input type="time" data-testid="check-in-input" />
          </TextField>
          <TextField fullWidth name="check-out" value={state.checkOutTime} onChange={state.setCheckOutTime}>
            <Label>Check-out — opcional</Label>
            <Input type="time" data-testid="check-out-input" />
          </TextField>
          {/* Arbitrage Jérôme du 2026-08-26 (« import à la liaison ») : la capacité redevient
              éditable même pour une chambre liée. Elle était masquée parce qu'elle faisait doublon
              avec le `capacity` de Lobby — sauf que rien ne la lisait chez eux, donc le champ
              restait simplement vide, et la fiche publique avec. Elle est désormais PRÉREMPLIE
              depuis Lobby (bouton « Usar estos datos » du picker) puis corrigeable ici. */}
          {isLodging ? (
            <TextField fullWidth name="capacity" value={state.capacity} onChange={state.setCapacity}>
              <Label>Capacidad (couchage) — opcional</Label>
              <Input type="number" min={1} data-testid="capacity-input" />
            </TextField>
          ) : null}
          {/* `quantity` (2026-08-26) : combien d'unités de ce type existent — 3 cabañas, 8 lits.
              Purement DESCRIPTIF, aucune RPC ne s'en sert pour autoriser une réservation (pour un
              logement PMS-backed, c'est Lobby qui tranche la disponibilité en direct). Préremplie
              depuis Lobby comme la capacité juste à côté ; le libellé nomme les deux unités
              possibles parce que « cantidad » seul se confondrait avec la capacité. */}
          {isLodging ? (
            <TextField fullWidth name="unit-count" value={state.unitCount} onChange={state.setUnitCount}>
              <Label>Cantidad (habitaciones o camas) — opcional</Label>
              <Input type="number" min={1} data-testid="unit-count-input" />
            </TextField>
          ) : null}

          {/* Nature du couchage (2026-08-27) — TROIS valeurs, pas deux. « Casa entera » n'est pas
              théorique : la v1 en production loue déjà Bania Travel comme maison entière. Elle ne
              viendra JAMAIS d'un import, le vocabulaire de Lobby n'ayant que privada/compartida —
              d'où la mention sous le champ quand l'établissement est connecté, sans quoi on
              chercherait longtemps pourquoi « Usar estos datos » ne la remplit pas. Descriptif :
              aucune RPC de commande ne le lit (cf. migration 20260827120000). */}
          {isLodging ? (
            <div className="flex flex-col gap-1">
              <Select
                fullWidth
                value={state.lodgingKind || LODGING_KIND_NONE}
                onChange={(value) =>
                  state.setLodgingKind(
                    !value || value === LODGING_KIND_NONE ? "" : (value as LodgingKind),
                  )
                }
              >
                <Label>Tipo de alojamiento — opcional</Label>
                <Select.Trigger data-testid="lodging-kind-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id={LODGING_KIND_NONE} textValue="Sin especificar">
                      Sin especificar
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {LODGING_KINDS.map((kind) => (
                      <ListBox.Item key={kind} id={kind} textValue={LODGING_KIND_LABELS[kind]}>
                        {LODGING_KIND_LABELS[kind]}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              {establishmentLobbyConnected ? (
                <p className="text-xs text-muted">
                  «Casa entera» no existe en LobbyPMS: siempre se elige a mano.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Unité de PRIX (2026-08-27, défaut C4). `products.unit` existait depuis le 13/08,
              contrainte et lue par la fiche publique, mais n'était écrite par RIEN — seul seed.sql
              la renseignait. Elle est ici pour la première fois saisissable. À ne pas confondre
              avec le champ juste au-dessus : celui-là dit ce QU'ON VEND (un lit, une chambre, une
              maison), celui-ci dit COMMENT ON LE FACTURE. La liaison Lobby ne la prérremplit que
              dans les cas non ambigus — leurs prix sont par niveau d'occupation, un modèle que
              hifago n'a pas (cf. proposeLodgingUnit). */}
          {isLodging ? (
            <Select
              fullWidth
              value={state.unit || LODGING_KIND_NONE}
              onChange={(value) =>
                state.setUnit(!value || value === LODGING_KIND_NONE ? "" : (value as LodgingUnit))
              }
            >
              <Label>Unidad de precio — opcional</Label>
              <Select.Trigger data-testid="lodging-unit-select">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={LODGING_KIND_NONE} textValue="Sin especificar">
                    Sin especificar
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {LODGING_UNITS.map((unit) => (
                    <ListBox.Item key={unit} id={unit} textValue={LODGING_UNIT_LABELS[unit]}>
                      {LODGING_UNIT_LABELS[unit]}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : null}
        </div>
      ) : null}

      {isLodging ? <StayRatesEditor value={state.stayRates} onChange={state.setStayRates} /> : null}

      {isCamp ? (
        <TextField
          fullWidth
          name="duration-days"
          value={state.durationDays}
          onChange={state.setDurationDays}
          isRequired
        >
          <Label>Duración (días)</Label>
          <Input type="number" min={1} data-testid="duration-days-input" />
        </TextField>
      ) : null}

      {hasProgram ? (
        <ProgramEditor
          value={state.program}
          onChange={state.setProgram}
          // La durée SAISIE prime sur la durée persistée : en création elle n'existe que dans le
          // formulaire, et en édition on veut suivre l'écran si l'admin la renseigne. `Number("")`
          // vaut 0, d'où le test sur la chaîne avant la conversion (même garde que
          // productCreationPayload).
          durationDays={
            state.durationDays.trim() !== "" && Number(state.durationDays) >= 1
              ? Number(state.durationDays)
              : campDurationDays
          }
        />
      ) : null}

      {isEvento ? (
        <>
          {allowOnlineBookableConfig ? (
            <Switch
              isSelected={state.onlineBookable}
              onChange={state.setOnlineBookable}
              data-testid="online-bookable-switch"
            >
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                {state.onlineBookable ? "Reservable en línea" : "Vitrina (no reservable en línea)"}
              </Switch.Content>
            </Switch>
          ) : null}

          {eventoReservableEnLinea ? (
            <>
              <Select
                fullWidth
                value={state.eventoCapacityMode}
                onChange={(value) =>
                  value && state.setEventoCapacityMode(value as "unlimited" | "metered" | "rsvp")
                }
              >
                <Label>Modo de capacidad</Label>
                <Select.Trigger data-testid="evento-capacity-mode-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="unlimited" textValue="Plazas ilimitadas">
                      Plazas ilimitadas — nunca bloquea, sin contador
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="metered" textValue="Cupo con descuento automático">
                      Cupo con descuento automático — bloquea al llenarse
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="rsvp" textValue="Aforo informativo con contador">
                      Aforo informativo con contador — nunca bloquea
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>

              {state.eventoCapacityMode === "metered" || state.eventoCapacityMode === "rsvp" ? (
                <TextField
                  fullWidth
                  name="evento-default-capacity"
                  value={state.defaultCapacity}
                  onChange={state.setDefaultCapacity}
                  isRequired
                >
                  <Label>
                    {state.eventoCapacityMode === "metered"
                      ? "Cupo máximo — bloquea nuevas reservas al llenarse"
                      : "Aforo informativo — nunca bloquea, solo se muestra como contador"}
                  </Label>
                  <Input type="number" min={1} data-testid="evento-default-capacity-input" />
                </TextField>
              ) : null}

              <Checkbox
                isSelected={state.isFree}
                onChange={state.setIsFree}
                data-testid="evento-is-free-checkbox"
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Evento gratuito
                </Checkbox.Content>
              </Checkbox>

              {!state.isFree ? (
                <>
                  <TextField
                    fullWidth
                    name="evento-price"
                    value={state.priceCop}
                    onChange={state.setPriceCop}
                    isRequired
                  >
                    <Label>Precio (COP)</Label>
                    <Input type="number" min={1} data-testid="evento-price-input" />
                  </TextField>

                  <Select
                    fullWidth
                    value={state.eventoPaymentMode}
                    onChange={(value) => value && state.setEventoPaymentMode(value as "online" | "on_site")}
                  >
                    <Label>Modo de pago</Label>
                    <Select.Trigger data-testid="evento-payment-mode-select">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="online" textValue="Pago en línea">
                          Pago en línea (Mercado Pago)
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="on_site" textValue="Pago en el establecimiento">
                          Pago en el establecimiento
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </>
              ) : null}

              <Checkbox
                isSelected={state.eventoOccupiesResource}
                onChange={state.setEventoOccupiesResource}
                data-testid="evento-occupies-resource-checkbox"
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Ocupa el recurso compartido del establecimiento (bloquea campamentos/otros eventos
                  reservables ese día)
                </Checkbox.Content>
              </Checkbox>
            </>
          ) : null}

          {!eventoReservableEnLinea ? (
            <TextField
              fullWidth
              name="price-label"
              value={state.priceLabel}
              onChange={state.setPriceLabel}
              isRequired
            >
              <Label>Precio (texto libre)</Label>
              <Input
                placeholder="Ej. Desde $50.000 COP, entrada gratuita…"
                data-testid="price-label-input"
              />
            </TextField>
          ) : null}

          <Select
            fullWidth
            value={state.occurrenceType}
            onChange={(value) => value && state.setOccurrenceType(value as "once" | "recurring")}
          >
            <Label>Ocurrencia</Label>
            <Select.Trigger data-testid="occurrence-type-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="once" textValue="Puntual">
                  Puntual
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="recurring" textValue="Recurrente">
                  Recurrente
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          {state.occurrenceType === "once" ? (
            <TextField
              fullWidth
              name="occurrence-date"
              value={state.occurrenceDate}
              onChange={state.setOccurrenceDate}
              isRequired
            >
              <Label>Fecha</Label>
              <Input type="date" data-testid="occurrence-date-input" />
            </TextField>
          ) : (
            <>
              {/* Fecha de la primera ocurrencia — ancre nécessaire pour savoir sur quel jour de la
                  semaine tombe la récurrence (ex. "cada 14 días" à partir d'un martes = un evento
                  tous les 2 mardis) : sans cette date, ce jour n'est mathématiquement pas
                  déterminable. Gap réel signalé par Jérôme (2026-08-18) : occurrence_date n'était
                  jusqu'ici collectée que pour occurrenceType="once". */}
              <TextField
                fullWidth
                name="occurrence-date"
                value={state.occurrenceDate}
                onChange={state.setOccurrenceDate}
                isRequired
              >
                <Label>Fecha de la primera ocurrencia</Label>
                <Input type="date" data-testid="occurrence-date-input" />
              </TextField>
              {state.occurrenceDate ? (
                <p className="text-xs text-muted" data-testid="occurrence-weekday-hint">
                  {occurrenceWeekdayHint(state.occurrenceDate, state.recurrenceFrequencyDays)}
                </p>
              ) : null}
              <TextField
                fullWidth
                name="recurrence-frequency"
                value={state.recurrenceFrequencyDays}
                onChange={state.setRecurrenceFrequencyDays}
                isRequired
              >
                <Label>Frecuencia (días)</Label>
                <Input type="number" min={1} data-testid="recurrence-frequency-input" />
              </TextField>
              <Select
                fullWidth
                value={state.recurrenceEndKind}
                onChange={(value) => value && state.setRecurrenceEndKind(value as "date" | "count" | "none")}
              >
                <Label>Fin de la recurrencia</Label>
                <Select.Trigger data-testid="recurrence-end-select">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="none" textValue="Indefinida">
                      Indefinida
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="date" textValue="Hasta una fecha">
                      Hasta una fecha
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="count" textValue="Número de repeticiones">
                      Número de repeticiones
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              {state.recurrenceEndKind === "date" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-date"
                  value={state.recurrenceEndDate}
                  onChange={state.setRecurrenceEndDate}
                  isRequired
                >
                  <Label>Fecha de fin</Label>
                  <Input type="date" data-testid="recurrence-end-date-input" />
                </TextField>
              ) : null}
              {state.recurrenceEndKind === "count" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-count"
                  value={state.recurrenceEndCount}
                  onChange={state.setRecurrenceEndCount}
                  isRequired
                >
                  <Label>Número de repeticiones</Label>
                  <Input type="number" min={1} data-testid="recurrence-end-count-input" />
                </TextField>
              ) : null}
            </>
          )}

          <TextField fullWidth name="start-time" value={state.startTime} onChange={state.setStartTime}>
            <Label>Hora de inicio — opcional</Label>
            <Input type="time" />
          </TextField>
          <TextField
            fullWidth
            name="duration"
            value={state.durationMinutes}
            onChange={state.setDurationMinutes}
          >
            <Label>Duración (minutos) — opcional</Label>
            <Input type="number" min={1} />
          </TextField>
        </>
      ) : null}

      {/* LA FICHE VITRINE — disponible pour TOUS les types depuis le 2026-09-08 (spec 30 §3.1).
          Ces deux champs vivaient dans le bloc `isEvento`, ce qui rendait la vitrine impossible
          ailleurs : le cahier §2e dit pourtant « ce n'est PAS réservé aux eventos ». C'est la
          PRÉSENCE de l'URL qui fait la vitrine, jamais le type — et jamais `sellable = false`, qui
          rendrait le produit invisible ET retirerait son établissement du public. */}
      {!isEvento ? (
        <>
          <TextField
            fullWidth
            name="external-booking-url"
            value={state.externalBookingUrl}
            onChange={state.setExternalBookingUrl}
          >
            <Label>Enlace de reserva externo — opcional</Label>
            <Input type="url" placeholder="https://…" data-testid="external-booking-url-input" />
          </TextField>

          {/* Le prix en texte libre n'a de sens qu'AVEC une URL externe : sans elle, le produit est
              réservable et porte un prix chiffré. Affiché à la demande plutôt que toujours, pour ne
              pas suggérer deux façons concurrentes de saisir un prix. */}
          {state.externalBookingUrl.trim() ? (
            <TextField
              fullWidth
              name="price-label"
              value={state.priceLabel}
              onChange={state.setPriceLabel}
            >
              <Label>Precio (texto libre) — opcional, sustituye al precio en COP</Label>
              <Input
                placeholder="Ej. Consultar, Desde $50.000 COP…"
                data-testid="price-label-vitrina-input"
              />
            </TextField>
          ) : null}
        </>
      ) : null}

      {showSlotRulesEditor && isActivity ? (
        <div className="flex flex-col gap-1.5">
          <Label>Horarios — opcional</Label>
          <SlotRulesEditor rules={state.slotRules} onChange={state.setSlotRules} />
        </div>
      ) : null}
    </>
  );
}
