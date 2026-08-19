"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, ImageCrop, Input, Label, Modal, TextArea, TextField, cn, toast } from "@hifago/ui";
import Link from "next/link";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { mountAddressAutocomplete } from "@/components/address-autocomplete";

type Partner = { id: string; display_name: string };
// Miroir local du type Json généré par Supabase (packages/supabase/src/database.types.ts) — pas
// réexporté par client.ts/server.ts, même convention que NewPartnerForm.tsx.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type DescriptionLang = "es" | "en";

// docs/specs/04-gestion-images.md — remplace le bucket/mécanisme provisoire de la spec 03
// (photo_urls, déprécié par 20260815110000_gestion_images.sql). Bucket unique pour tout le
// catalogue, dossier establishments/ par lisibilité (§6). Upload via le Route Handler
// service_role (POST /api/upload/establishment, §7 du spec 04) : recadrage client + conversion
// WebP/strip EXIF, le même pipeline que la fiche produit (ProductPhotosBlock) — plus l'upload
// direct basique posé par la spec 03 en attendant que ce pipeline existe.
const MAX_PHOTOS = 6; // plafond uniforme décidé (spec 04 §3), déjà appliqué côté RPC

// Même constante que packages/ui/src/components/media-gallery.tsx (bouton flottant sur une
// vignette photo) — un scrim sombre fixe reste lisible quelle que soit la photo derrière, à
// l'inverse d'un contour qui dépend du contraste avec les jetons de couleur ambiants.
const overlayButtonClass =
  "flex h-7 w-7 items-center justify-center bg-black/55 text-sm leading-none text-white transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-40";

export function NewEstablishmentForm({
  partners,
  defaultPartnerId = null,
}: {
  partners: Partner[];
  defaultPartnerId?: string | null;
}) {
  const router = useRouter();

  // Identidad
  const [nombre, setNombre] = useState("");
  const [operatedDirectly, setOperatedDirectly] = useState(false);

  // Rattachement partenaire — préréempli depuis ?partner_id= (docs/specs/05-invitations-onboarding-
  // dashboard-partenaire.md §5.6), ex. depuis le badge « Falta establecimiento » de
  // /admin/invitations. L'admin garde la main : le champ reste modifiable, ce n'est qu'une valeur
  // initiale, pas un verrouillage.
  const [partnerId, setPartnerId] = useState<string | null>(defaultPartnerId);

  // Presentación
  const [descriptionEs, setDescriptionEs] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionLang, setDescriptionLang] = useState<DescriptionLang>("es");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [photos, setPhotos] = useState<{ path: string; url: string }[]>([]);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const addressSearchRef = useRef<HTMLDivElement | null>(null);

  // Même widget que la création partenaire (docs/specs/01-admin-creation-partenaire.md §5) —
  // repli manuel toujours possible, no-op silencieux si la clé Google Maps est absente.
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

  // L'établissement n'a pas encore d'id à ce stade du formulaire : le Route Handler d'upload
  // n'a besoin que du type d'entité pour choisir le dossier de rangement (§7 du spec 04), pas
  // d'un establishment_id réel. Les lignes establishment_media (avec le vrai establishment_id)
  // ne sont créées qu'à la soumission, via add_catalog_media (cf. handleSubmit) — la table a une
  // FK not null, contrairement à l'ancien tableau plat photo_urls.
  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImage(URL.createObjectURL(file));
  }

  async function handleCropConfirm(blob: Blob) {
    setIsUploadingPhotos(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.png");
      const response = await fetch("/api/upload/establishment", { method: "POST", body: formData });
      const result = (await response.json()) as
        | { ok: true; storage_path: string }
        | { ok: false; reason: string };

      if (!result.ok) {
        toast.danger("No se pudo subir la foto.");
        return;
      }
      setPhotos((prev) => [...prev, { path: result.storage_path, url: URL.createObjectURL(blob) }]);
      toast.success("Foto añadida.");
    } finally {
      if (pendingImage) URL.revokeObjectURL(pendingImage);
      setPendingImage(null);
      setIsUploadingPhotos(false);
    }
  }

  function handleCropCancel() {
    if (pendingImage) URL.revokeObjectURL(pendingImage);
    setPendingImage(null);
  }

  function removePhoto(path: string) {
    setPhotos((prev) => prev.filter((photo) => photo.path !== path));
  }

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

    if (!partnerId || !nombre.trim()) {
      toast.danger("El nombre y el partner son obligatorios.");
      return;
    }

    setIsSubmitting(true);

    // name reste jsonb multilingue en base (même pattern que products.name), mais le formulaire
    // n'expose qu'un seul champ : un nom d'établissement est un nom propre, généralement pas
    // traduit (décision Jérôme, spec §3). Le repli de resolveLocalizedField renvoie déjà cette
    // valeur pour un lecteur EN en l'absence de clé "en".
    const name: Json = { es: nombre.trim() };

    const supabase = createClient();
    const { data: establishmentId, error: rpcError } = await supabase.rpc("create_establishment", {
      p_partner_id: partnerId,
      p_name: name,
      p_description: buildDescription(),
      p_address: address.trim() || undefined,
      p_lat: lat.trim() ? Number(lat) : undefined,
      p_lon: lon.trim() ? Number(lon) : undefined,
      p_operated_directly: operatedDirectly,
    });

    if (rpcError || !establishmentId) {
      toast.danger("No se pudo crear el establecimiento.");
      setIsSubmitting(false);
      return;
    }

    // Les photos déjà uploadées dans le bucket (cf. handleFilesSelected) sont rattachées
    // maintenant que l'établissement existe (establishment_media.establishment_id est not null,
    // spec 04 §6) — un échec ici n'annule pas la création déjà réussie (spec 03 §9 : une photo en
    // échec ne bloque jamais la création), juste un avertissement non bloquant. Chaque appel est
    // indépendant (p_sort distinct par photo) : lancés en parallèle plutôt qu'attendus un par un.
    const mediaResults = await Promise.all(
      photos.map((photo, index) =>
        supabase.rpc("add_catalog_media", {
          p_entity_type: "establishment",
          p_entity_id: establishmentId,
          p_storage_path: photo.path,
          p_sort: index,
        })
      )
    );
    for (const { error: mediaError } of mediaResults) {
      if (mediaError) {
        toast.danger("El establecimiento se creó, pero una foto no se pudo asociar.");
      }
    }

    toast.success("Establecimiento creado.");
    router.push("/admin/establishments");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">Identidad</legend>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            name="nombre"
            required
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
        </div>

        <Checkbox
          data-testid="operated-directly-checkbox"
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
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-semibold">Partner propietario</legend>
        <SearchableCombobox
          items={partners}
          getKey={(partner) => partner.id}
          getLabel={(partner) => partner.display_name}
          value={partnerId}
          onChange={setPartnerId}
          label="Partner propietario"
          placeholder="Buscar partner…"
          testId="partner-search"
        />
        <p className="text-xs text-muted">
          ¿No encuentras el partner?{" "}
          <Link href="/admin/partners/new" className="underline">
            Créalo primero
          </Link>
          , luego vuelve aquí.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">Presentación — opcional</legend>

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
                  data-testid={`description-lang-${lang}`}
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
          <TextArea data-testid="description-textarea" />
        </TextField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address-search">Buscar dirección (Google)</Label>
          {/* Web Component Google — pas de <Input> HeroUI ici, il gère son propre champ interne */}
          <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">Dirección</Label>
          <Input
            id="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
            data-testid="address-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lat">Latitud — detectada o manual</Label>
            <Input id="lat" value={lat} onChange={(event) => setLat(event.target.value)} data-testid="lat-input" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lon">Longitud — detectada o manual</Label>
            <Input id="lon" value={lon} onChange={(event) => setLon(event.target.value)} data-testid="lon-input" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photos">Fotos — máximo {MAX_PHOTOS}</Label>
          <label
            className={cn(
              "flex w-fit cursor-pointer items-center gap-2 border border-dashed border-default px-4 py-2 text-sm text-muted",
              (photos.length >= MAX_PHOTOS || isUploadingPhotos) && "pointer-events-none opacity-50"
            )}
          >
            <input
              id="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelected}
              disabled={photos.length >= MAX_PHOTOS || isUploadingPhotos}
              data-testid="photos-input"
              className="hidden"
            />
            <span>Añadir foto</span>
            <span className="text-xs">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </label>
          {isUploadingPhotos ? <p className="text-xs text-muted">Subiendo…</p> : null}
          {photos.length > 0 ? (
            <ul className="flex flex-wrap gap-2" data-testid="photos-list">
              {photos.map((photo) => (
                <li key={photo.path} className="relative overflow-hidden rounded-md border border-default">
                  {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local d'un Blob
                      pas encore rattaché à un establishment_id ; next/image exigerait une URL
                      Storage réelle, pas un object URL éphémère. */}
                  <img src={photo.url} alt="" className="h-24 w-24 object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.path)}
                    aria-label="Quitar foto"
                    className={cn(overlayButtonClass, "absolute right-1 top-1 h-6 w-6")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Modal>
            <Modal.Backdrop
              isOpen={pendingImage !== null}
              onOpenChange={(isOpen) => {
                if (!isOpen) handleCropCancel();
              }}
            >
              <Modal.Container>
                <Modal.Dialog data-testid="establishment-photo-crop-panel">
                  <Modal.Header>
                    <Modal.Heading>Recortar foto</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    {pendingImage ? (
                      <ImageCrop imageSrc={pendingImage} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
                    ) : null}
                  </Modal.Body>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        </div>
      </fieldset>

      <Button
        type="submit"
        isDisabled={isSubmitting || isUploadingPhotos}
        data-testid="create-establishment-button"
      >
        {isSubmitting ? "Creando…" : "Crear establecimiento"}
      </Button>
    </form>
  );
}
