"use client";

import { useEffect, useRef } from "react";
import { Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { SlotRulesEditor } from "@/components/slot-rules-editor";
import { StayRatesEditor } from "@/components/stay-rates-editor";
import { HotelRoomsEditor } from "@/components/hotel-rooms-editor";
import { PriceTiersEditor } from "@/components/price-tiers-editor";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";
import { productTypeGating, type ProductType, type ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// apps/admin n'est pas localisé (hifago/CLAUDE.md §2 point 1) — locale "es" fixe, même convention
// que tout le reste de ce formulaire (labels en dur, pas de next-intl).
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es", { weekday: "long" });

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
  showHotelRoomsEditor,
  showSlotRulesEditor,
  allowCreateTags,
  hidePhotosInHotelRooms,
  availableTags,
}: {
  type: ProductType;
  state: ProductTypeFieldsState;
  // showTags/showHotelRoomsEditor/showSlotRulesEditor : réplique exacte du gating "création
  // seulement" déjà en place dans ProductForm (spec 11 : "délégués en édition à des blocs
  // séparés") — décidé par l'appelant (ProductForm passe `!isEditing`), pas recalculé ici.
  // address/lat/lon/prix/tramos/min-max/check-in-out/capacité/stay_rates restent, eux, affichés
  // dans les deux modes, donc jamais gatés par ces props.
  showTags?: boolean;
  showHotelRoomsEditor?: boolean;
  showSlotRulesEditor?: boolean;
  allowCreateTags?: boolean;
  hidePhotosInHotelRooms?: boolean;
  availableTags?: TagOption[];
}) {
  const {
    isEvento, isCamp, isActivity, isLodging, isHotel,
    hasLocationAndTags, hasTags, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity,
  } = productTypeGating(type);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

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

      {showTags && hasTags ? (
        <TagsMultiSelect
          availableTags={availableTags ?? []}
          selectedTagIds={state.selectedTagIds}
          onChange={state.setSelectedTagIds}
          allowCreate={allowCreateTags}
          testId="tags-multiselect"
        />
      ) : null}

      {!isEvento && !hasLocationAndTags ? (
        <TextField fullWidth name="price" value={state.priceCop} onChange={state.setPriceCop} isRequired>
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

      {hasCheckInOut ? (
        <div className={isLodging ? "grid grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
          <TextField fullWidth name="check-in" value={state.checkInTime} onChange={state.setCheckInTime}>
            <Label>Check-in — opcional</Label>
            <Input type="time" data-testid="check-in-input" />
          </TextField>
          <TextField fullWidth name="check-out" value={state.checkOutTime} onChange={state.setCheckOutTime}>
            <Label>Check-out — opcional</Label>
            <Input type="time" data-testid="check-out-input" />
          </TextField>
          {isLodging ? (
            <TextField fullWidth name="capacity" value={state.capacity} onChange={state.setCapacity}>
              <Label>Capacidad (couchage) — opcional</Label>
              <Input type="number" min={1} data-testid="capacity-input" />
            </TextField>
          ) : null}
        </div>
      ) : null}

      {isLodging ? <StayRatesEditor value={state.stayRates} onChange={state.setStayRates} /> : null}

      {showHotelRoomsEditor && isHotel ? (
        <div className="flex flex-col gap-1.5">
          <Label>Habitaciones — opcional</Label>
          <HotelRoomsEditor rooms={state.hotelRooms} onChange={state.setHotelRooms} hidePhotos={hidePhotosInHotelRooms} />
        </div>
      ) : null}

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

      {isEvento ? (
        <>
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
          <TextField
            fullWidth
            name="external-booking-url"
            value={state.externalBookingUrl}
            onChange={state.setExternalBookingUrl}
          >
            <Label>Enlace de reserva externo</Label>
            <Input type="url" placeholder="https://…" data-testid="external-booking-url-input" />
          </TextField>
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
