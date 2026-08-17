"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Input, Label, TextArea, TextField, cn } from "@hifago/ui";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";

// Miroir local du type Json généré par Supabase — même convention que NewEstablishmentForm.tsx.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type DescriptionLang = "es" | "en";

// docs/specs/06-gestion-etablissement.md §5.1 — comble le gap cahier admin §3c ("toute la
// présentation d'un établissement s'édite depuis l'admin") : jusqu'ici seules les photos étaient
// éditables après création (EstablishmentPhotosBlock, spec 04). update_establishment remplace tous
// les champs de présentation en un seul appel (pas un patch partiel).
export function EstablishmentEditBlock({
  establishmentId,
  initialNameEs,
  initialDescriptionEs,
  initialDescriptionEn,
  initialAddress,
  initialLat,
  initialLon,
  initialOperatedDirectly,
  pendingEditProposalId,
}: {
  establishmentId: string;
  initialNameEs: string;
  initialDescriptionEs: string;
  initialDescriptionEn: string;
  initialAddress: string;
  initialLat: string;
  initialLon: string;
  initialOperatedDirectly: boolean;
  pendingEditProposalId: string | null;
}) {
  const router = useRouter();

  const [nombre, setNombre] = useState(initialNameEs);
  const [operatedDirectly, setOperatedDirectly] = useState(initialOperatedDirectly);
  const [descriptionEs, setDescriptionEs] = useState(initialDescriptionEs);
  const [descriptionEn, setDescriptionEn] = useState(initialDescriptionEn);
  const [descriptionLang, setDescriptionLang] = useState<DescriptionLang>("es");
  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState(initialLat);
  const [lon, setLon] = useState(initialLon);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = addressSearchRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, (place) => {
      setAddress(place.address);
      if (place.lat !== null && place.lon !== null) {
        setLat(String(place.lat));
        setLon(String(place.lon));
      }
    });
  }, []);

  function buildDescription(): Json | undefined {
    const es = descriptionEs.trim();
    const en = descriptionEn.trim();
    if (!es && !en) return undefined;
    const value: { [key: string]: Json } = {};
    if (es) value.es = es;
    if (en) value.en = en;
    return value;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("update_establishment", {
      p_establishment_id: establishmentId,
      p_name: { es: nombre.trim() } as Json,
      p_description: buildDescription(),
      p_address: address.trim() || undefined,
      p_lat: lat.trim() ? Number(lat) : undefined,
      p_lon: lon.trim() ? Number(lon) : undefined,
      p_operated_directly: operatedDirectly,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean } | null;
    if (rpcError || !result?.ok) {
      setError("No se pudo actualizar el establecimiento.");
      return;
    }

    setSuccess(true);
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-surface p-4" data-testid="establishment-edit-block">
      <h2 className="mb-4 text-sm font-medium">Editar establecimiento</h2>

      {pendingEditProposalId ? (
        <p
          role="status"
          data-testid="pending-edit-proposal-banner"
          className="mb-4 rounded-md border border-warning bg-warning/10 p-3 text-sm"
        >
          Hay una propuesta de edición pendiente del partner.{" "}
          <Link
            href={`/admin/proposals/${pendingEditProposalId}?entity=establishment`}
            className="underline"
          >
            Revisar propuesta
          </Link>
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-nombre">Nombre</Label>
          <Input
            id="edit-nombre"
            name="edit-nombre"
            required
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
        </div>

        <Checkbox
          data-testid="edit-operated-directly-checkbox"
          isSelected={operatedDirectly}
          onChange={setOperatedDirectly}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Operado directamente por la plataforma
          </Checkbox.Content>
        </Checkbox>

        <TextField
          fullWidth
          value={descriptionLang === "es" ? descriptionEs : descriptionEn}
          onChange={(value) =>
            descriptionLang === "es" ? setDescriptionEs(value) : setDescriptionEn(value)
          }
        >
          <div className="flex items-center justify-between">
            <Label>Descripción</Label>
            <div className="flex gap-1" role="group" aria-label="Idioma de la descripción">
              {(["es", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  data-testid={`edit-description-lang-${lang}`}
                  onClick={() => setDescriptionLang(lang)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium uppercase",
                    descriptionLang === lang
                      ? "bg-accent text-accent-foreground"
                      : "text-muted hover:bg-muted/50",
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
          <TextArea data-testid="edit-description-textarea" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-address-search">Buscar dirección (Google)</Label>
          <div id="edit-address-search" ref={addressSearchRef} data-testid="edit-address-search" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-address">Dirección</Label>
          <Input
            id="edit-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            data-testid="edit-address-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-lat">Latitud</Label>
            <Input
              id="edit-lat"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              data-testid="edit-lat-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-lon">Longitud</Label>
            <Input
              id="edit-lon"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              data-testid="edit-lon-input"
            />
          </div>
        </div>

        {success ? (
          <p role="status" data-testid="establishment-edit-success" className="text-sm text-success">
            Establecimiento actualizado.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" isDisabled={isSubmitting} data-testid="save-establishment-button">
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>
    </div>
  );
}
