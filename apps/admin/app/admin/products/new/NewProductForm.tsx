"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { slugify } from "@/lib/utils";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Button, Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import {
  emptyTier,
  lowestTierPrice,
  toPriceTiersColumn,
  validatePriceTiers,
  type PriceTier,
} from "@/lib/products/priceTiers";

type Establishment = { id: string; name: unknown; partner_id: string };

type ProductType = "activity" | "evento" | "camp";
type OccurrenceType = "once" | "recurring";
type RecurrenceEndKind = "date" | "count" | "none";
type PriceMode = "simple" | "tiers";

export function NewProductForm({
  establishments,
  initialEstablishmentId,
  allTags,
}: {
  establishments: Establishment[];
  initialEstablishmentId: string;
  allTags: TagOption[];
}) {
  const router = useRouter();
  const [establishmentId, setEstablishmentId] = useState(initialEstablishmentId);
  // Un seul champ, pas de saisie ES/EN séparée — même décision que l'établissement (spec 03) : le
  // nom d'une activité est généralement un nom propre, pas traduit. Toujours stocké {es: valeur}
  // dans la colonne name (jsonb existante, aucun changement de schéma) — resolveLocalizedField
  // renvoie naturellement cette valeur à un lecteur EN en l'absence de clé "en".
  const [nombre, setNombre] = useState("");
  const [type, setType] = useState<ProductType>("activity");
  const [priceCop, setPriceCop] = useState("");

  // Feature 21 (evento vitrine) : éditorial, prix en texte libre, aucun cupo, lien de réservation
  // externe. Récurrence structurée (occurrence_type + fréquence + condition de fin), jamais du
  // texte libre — tranché par Jérôme en anticipation du futur mode réservable.
  const [priceLabel, setPriceLabel] = useState("");
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceType>("once");
  const [occurrenceDate, setOccurrenceDate] = useState("");
  const [recurrenceFrequencyDays, setRecurrenceFrequencyDays] = useState("");
  const [recurrenceEndKind, setRecurrenceEndKind] = useState<RecurrenceEndKind>("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [recurrenceEndCount, setRecurrenceEndCount] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [externalBookingUrl, setExternalBookingUrl] = useState("");

  // Feature 20 (camp multi-jours) : durée en jours, camp uniquement — même convention que
  // stay_rates pour le lodging (Tranche 2), un champ spécifique à un seul type. Chemin
  // admin-direct seulement ; la ressource partagée (provider_resource_calendar) se configure à
  // part, depuis /admin/establishments/[id]/resource, jamais ici.
  const [durationDays, setDurationDays] = useState("");

  // Spec 08 (gestion CRUD d'une activité) : tags, paliers de prix, bornes de quantité — réservés
  // au type "activity" (pas evento/camp, hors périmètre de cette spec), écran partagé conservé.
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [priceMode, setPriceMode] = useState<PriceMode>("simple");
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([emptyTier()]);
  const [minQty, setMinQty] = useState("");
  const [maxQty, setMaxQty] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEvento = type === "evento";
  const isCamp = type === "camp";
  const isActivity = type === "activity";

  function updateTier(index: number, next: PriceTier) {
    setPriceTiers((prev) => prev.map((tier, i) => (i === index ? next : tier)));
  }

  function removeTier(index: number) {
    setPriceTiers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // partner_id n'est jamais saisi indépendamment — dérivé de l'établissement choisi, cf. plan
    // feature 2 (products.partner_id reste un champ dérivé en pratique, pas un second input).
    const establishment = establishments.find((item) => item.id === establishmentId);
    const price = Number(priceCop);

    const usesTiers = isActivity && priceMode === "tiers";

    if (!establishment || !nombre.trim()) {
      setError("El nombre (es) y el establecimiento son obligatorios.");
      return;
    }
    if (!isEvento && !usesTiers && (!Number.isFinite(price) || price <= 0)) {
      setError("El precio es obligatorio para este tipo de producto.");
      return;
    }
    if (isEvento && !priceLabel.trim()) {
      setError("El precio en texto libre es obligatorio para un evento.");
      return;
    }
    if (isEvento && occurrenceType === "once" && !occurrenceDate) {
      setError("La fecha es obligatoria para un evento puntual.");
      return;
    }
    if (isEvento && occurrenceType === "recurring" && !recurrenceFrequencyDays) {
      setError("La frecuencia es obligatoria para un evento recurrente.");
      return;
    }
    if (isCamp && (!durationDays || Number(durationDays) < 1)) {
      setError("La duración (días) es obligatoria para un campamento.");
      return;
    }
    if (isActivity && priceMode === "tiers") {
      const tiersError = validatePriceTiers(priceTiers);
      if (tiersError) {
        setError(tiersError);
        return;
      }
    }
    if (isActivity && minQty.trim() && maxQty.trim() && Number(minQty) > Number(maxQty)) {
      setError("La cantidad mínima no puede ser mayor a la máxima.");
      return;
    }

    setIsSubmitting(true);

    const name: Record<string, string> = { es: nombre.trim() };

    const supabase = createClient();
    const { data: newProduct, error: insertError } = await supabase
      .from("products")
      .insert({
        partner_id: establishment.partner_id,
        establishment_id: establishment.id,
        type,
        name,
        slug: slugify(nombre),
        // Explicitement false à la création (pas la valeur par défaut true de la colonne) : créer
        // un produit ne le rend pas vendable immédiatement, c'est la feature 4 (publier/dépublier)
        // qui bascule ce booléen.
        sellable: false,
        // price_cop null pour un evento (contrainte products_price_cop_required_unless_evento) —
        // price_label le remplace, texte libre. Un camp garde un prix réel comme n'importe quelle
        // activité (par participant/départ), rien de spécial ici.
        price_cop: isEvento ? null : price,
        // duration_days : camp uniquement (contrainte products_duration_days_required_for_camp) —
        // null pour tous les autres types, y compris evento.
        duration_days: isCamp ? Number(durationDays) : null,
        ...(isEvento
          ? {
              price_label: priceLabel.trim(),
              occurrence_type: occurrenceType,
              occurrence_date: occurrenceType === "once" ? occurrenceDate : null,
              recurrence_frequency_days:
                occurrenceType === "recurring" ? Number(recurrenceFrequencyDays) : null,
              recurrence_end_date:
                occurrenceType === "recurring" && recurrenceEndKind === "date"
                  ? recurrenceEndDate
                  : null,
              recurrence_end_count:
                occurrenceType === "recurring" && recurrenceEndKind === "count"
                  ? Number(recurrenceEndCount)
                  : null,
              start_time: startTime || null,
              duration_minutes: durationMinutes ? Number(durationMinutes) : null,
              external_booking_url: externalBookingUrl.trim() || null,
            }
          : {}),
        // Spec 08 : paliers de prix (remplace price_cop simple pour le calcul réel côté
        // create_order, cf. migration 20260815240000) — price_cop reste renseigné pour
        // l'affichage catalogue (prix du tramo le plus bas), jamais transmis par le client à la
        // RPC de commande de toute façon (résolu serveur-side).
        ...(isActivity && priceMode === "tiers"
          ? { price_cop: lowestTierPrice(priceTiers), price_tiers: toPriceTiersColumn(priceTiers) }
          : {}),
        ...(isActivity && minQty.trim() ? { min_qty: Number(minQty) } : {}),
        ...(isActivity && maxQty.trim() ? { max_qty: Number(maxQty) } : {}),
      })
      .select("id")
      .single();

    if (insertError || !newProduct) {
      setError(isEvento ? "No se pudo crear el evento." : "No se pudo crear la actividad.");
      setIsSubmitting(false);
      return;
    }

    // Tags optionnels, jamais bloquants : un échec ici laisse le produit créé sans ses tags,
    // corrigible depuis l'édition (ProductTagsBlock) — même discipline que les photos (spec 04).
    if (selectedTagIds.length > 0) {
      const { error: tagsError } = await supabase
        .from("product_tag_assignments")
        .insert(selectedTagIds.map((tagId) => ({ product_id: newProduct.id, tag_id: tagId })));
      if (tagsError) {
        console.warn("[NewProductForm] product_tag_assignments a échoué :", tagsError);
      }
    }

    router.push("/admin/establishments");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <TextField fullWidth name="nombre" value={nombre} onChange={setNombre} isRequired>
        <Label>Nombre</Label>
        <Input id="nombre" />
      </TextField>
      <Select
        fullWidth
        placeholder="Selecciona un establecimiento"
        value={establishmentId}
        onChange={(value) => value && setEstablishmentId(value as string)}
      >
        <Label>Establecimiento</Label>
        <Select.Trigger data-testid="establishment-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {establishments.map((establishment) => {
              const label =
                resolveLocalizedField(asLocalizedField(establishment.name), "es") ??
                establishment.id;
              return (
                <ListBox.Item key={establishment.id} id={establishment.id} textValue={label}>
                  {label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              );
            })}
          </ListBox>
        </Select.Popover>
      </Select>
      <Select
        fullWidth
        value={type}
        onChange={(value) => value && setType(value as ProductType)}
      >
        <Label>Tipo</Label>
        <Select.Trigger data-testid="type-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="activity" textValue="Actividad">
              Actividad
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {/* Vitrine seule (feature 21) : éditorial, sin cupo, enlace de reserva externo — no
                el modo reservable, que reutilizará la feature 20. */}
            <ListBox.Item id="evento" textValue="Evento (vitrina)">
              Evento (vitrina)
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="camp" textValue="Campamento">
              Campamento
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>

      {isActivity ? (
        <TagsMultiSelect
          availableTags={allTags}
          selectedTagIds={selectedTagIds}
          onChange={setSelectedTagIds}
          testId="tags-multiselect"
        />
      ) : null}

      {!isEvento && !isActivity ? (
        <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
          <Label>Precio (COP)</Label>
          <Input id="price" type="number" min={1} />
        </TextField>
      ) : null}

      {isActivity ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Precio</Label>
            <button
              type="button"
              data-testid="price-mode-toggle"
              onClick={() => setPriceMode(priceMode === "simple" ? "tiers" : "simple")}
              className="text-xs font-medium underline"
            >
              {priceMode === "simple" ? "Definir por tramos" : "Volver a precio simple"}
            </button>
          </div>
          {priceMode === "simple" ? (
            <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
              <Input id="price" type="number" min={1} data-testid="price-input" />
            </TextField>
          ) : (
            <div className="flex flex-col gap-2" data-testid="price-tiers-editor">
              {priceTiers.map((tier, index) => (
                <div key={index} className="flex items-end gap-2">
                  <TextField value={tier.minQty} onChange={(value) => updateTier(index, { ...tier, minQty: value })}>
                    <Label>Desde</Label>
                    <Input type="number" min={1} data-testid={`price-tier-min-${index}`} />
                  </TextField>
                  <TextField value={tier.maxQty} onChange={(value) => updateTier(index, { ...tier, maxQty: value })}>
                    <Label>Hasta</Label>
                    <Input type="number" min={1} data-testid={`price-tier-max-${index}`} />
                  </TextField>
                  <TextField
                    value={tier.priceCop}
                    onChange={(value) => updateTier(index, { ...tier, priceCop: value })}
                  >
                    <Label>Precio (COP)</Label>
                    <Input type="number" min={1} data-testid={`price-tier-price-${index}`} />
                  </TextField>
                  {priceTiers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeTier(index)}
                      aria-label="Quitar tramo"
                      data-testid={`remove-price-tier-${index}`}
                      className="pb-2 text-sm text-danger"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPriceTiers((prev) => [...prev, emptyTier()])}
                data-testid="add-price-tier-button"
                className="self-start text-xs font-medium underline"
              >
                + Agregar tramo
              </button>
            </div>
          )}
        </div>
      ) : null}

      {isActivity ? (
        <div className="grid grid-cols-2 gap-4">
          <TextField value={minQty} onChange={setMinQty}>
            <Label>Cantidad mínima — opcional</Label>
            <Input type="number" min={1} data-testid="min-qty-input" />
          </TextField>
          <TextField value={maxQty} onChange={setMaxQty}>
            <Label>Cantidad máxima — opcional</Label>
            <Input type="number" min={1} data-testid="max-qty-input" />
          </TextField>
        </div>
      ) : null}

      {isCamp ? (
        <TextField
          fullWidth
          name="duration-days"
          value={durationDays}
          onChange={setDurationDays}
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
            value={priceLabel}
            onChange={setPriceLabel}
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
            value={occurrenceType}
            onChange={(value) => value && setOccurrenceType(value as OccurrenceType)}
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

          {occurrenceType === "once" ? (
            <TextField
              fullWidth
              name="occurrence-date"
              value={occurrenceDate}
              onChange={setOccurrenceDate}
              isRequired
            >
              <Label>Fecha</Label>
              <Input type="date" data-testid="occurrence-date-input" />
            </TextField>
          ) : (
            <>
              <TextField
                fullWidth
                name="recurrence-frequency"
                value={recurrenceFrequencyDays}
                onChange={setRecurrenceFrequencyDays}
                isRequired
              >
                <Label>Frecuencia (días)</Label>
                <Input type="number" min={1} data-testid="recurrence-frequency-input" />
              </TextField>
              <Select
                fullWidth
                value={recurrenceEndKind}
                onChange={(value) => value && setRecurrenceEndKind(value as RecurrenceEndKind)}
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
              {recurrenceEndKind === "date" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-date"
                  value={recurrenceEndDate}
                  onChange={setRecurrenceEndDate}
                  isRequired
                >
                  <Label>Fecha de fin</Label>
                  <Input type="date" data-testid="recurrence-end-date-input" />
                </TextField>
              ) : null}
              {recurrenceEndKind === "count" ? (
                <TextField
                  fullWidth
                  name="recurrence-end-count"
                  value={recurrenceEndCount}
                  onChange={setRecurrenceEndCount}
                  isRequired
                >
                  <Label>Número de repeticiones</Label>
                  <Input type="number" min={1} data-testid="recurrence-end-count-input" />
                </TextField>
              ) : null}
            </>
          )}

          <TextField fullWidth name="start-time" value={startTime} onChange={setStartTime}>
            <Label>Hora de inicio — opcional</Label>
            <Input type="time" />
          </TextField>
          <TextField
            fullWidth
            name="duration"
            value={durationMinutes}
            onChange={setDurationMinutes}
          >
            <Label>Duración (minutos) — opcional</Label>
            <Input type="number" min={1} />
          </TextField>
          <TextField
            fullWidth
            name="external-booking-url"
            value={externalBookingUrl}
            onChange={setExternalBookingUrl}
          >
            <Label>Enlace de reserva externo</Label>
            <Input type="url" placeholder="https://…" data-testid="external-booking-url-input" />
          </TextField>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting} data-testid="create-product-button">
        {isSubmitting ? "Creando…" : isEvento ? "Crear evento" : "Crear actividad"}
      </Button>
    </form>
  );
}
