"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { slugify } from "@/lib/utils";
import { asLocalizedField } from "@hifago/domain";
import type { Json } from "@hifago/supabase/database.types";
import { Button, Label, ListBox, Select, toast } from "@hifago/ui";
import { type TagOption } from "@/components/tags-multiselect";
import {
  LocalizedTextField,
  buildLocalizedPayload,
  type LocalizedValue,
} from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { LobbyRoomOption } from "@/components/lobby-option-picker";
import { StagedProductPhotos, type StagedPhoto } from "@/components/product-photos-staged";
import { lowestTierPrice, toPriceTiersColumn, validatePriceTiers } from "@/lib/products/priceTiers";
import { validateSlotRules, toSlotRuleRows } from "@/lib/products/slotRules";
import { toStayRatesColumn, validateStayRates } from "@/lib/products/stayRates";
import { toRoomTypeRow, validateRoomTypes } from "@/lib/products/hotelRooms";
import { buildProductCreationPayload } from "@/lib/products/productCreationPayload";
import {
  productTypeGating,
  useProductTypeFieldsState,
  type ProductType,
} from "@/lib/products/useProductTypeFieldsState";

type Establishment = {
  id: string;
  name: unknown;
  partner_id: string;
  lobby_connector_active?: boolean | null;
  lobby_has_token?: boolean | null;
};

export type EditableProduct = {
  id: string;
  name: unknown;
  description: unknown;
  address: string | null;
  lat: number | null;
  lon: number | null;
  price_cop: number | null;
  price_tiers: unknown;
  min_qty: number | null;
  max_qty: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  capacity: number | null;
  unit_count: number | null;
  default_capacity: number | null;
  stay_rates: unknown;
  type: string;
  establishment_id: string;
  lobby_category_id: number | null;
  lobby_product_id: number | null;
  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — statut du connecteur de l'établissement
  // parent, nécessaire en édition pour savoir si le picker (vs saisie manuelle) doit s'afficher.
  lobby_connector_active?: boolean | null;
  lobby_has_token?: boolean | null;
};

// Spec 15 — variant "socio-proposal" : un socio ne peut jamais écrire products directement (RLS
// admin-only, jamais étendue), donc handleSubmit appelle submit_product_creation_proposal au lieu
// d'insérer, et attend une modération avant que la fiche existe réellement. Mêmes 3 codes
// "not_found"/"suspended"/"invalid" que les autres RPC de proposition du projet.
const SUBMIT_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  establishment_not_found: "No se encontró el establecimiento seleccionado.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  invalid_type: "Tipo de producto no válido.",
  name_required: "El nombre es obligatorio.",
  // pending_creation_exists retiré côté serveur (2026-08-18) : un socio peut désormais proposer
  // plusieurs créations en attente sur le même establecimiento, cf. 20260818110000_
  // product_creation_review_ux.sql — cette raison n'est plus jamais renvoyée par la RPC.
  pending_cap_exceeded: "Tienes demasiadas propuestas pendientes de revisión.",
};

// Spec 11 — un seul composant pour la création ET l'édition d'un produit (fusionne
// NewProductForm.tsx/EditProductForm.tsx, supprimés) : `product` absent = création, présent =
// édition. Établissement/type restent création-only (immuables après création, comportement
// préexistant) ; les champs evento/camp restent création-only (gap préexistant, jamais éditables
// aujourd'hui, hors scope Jérôme — "on va rester encore sur une activité"). Nom/description/lieu/
// prix-tramos/min-max deviennent identiques dans les deux modes — c'est le cœur du fix demandé.
// Photos/tags/créneaux sont "stagés" en création (rattachés au produit dans le MÊME clic de
// soumission que l'insert, cf. handleSubmit) et délégués en édition à des blocs séparés à
// sauvegarde immédiate rendus par la page (ProductPhotosBlock/ProductTagsBlock/
// ProductSlotRulesBlock), jamais par ce composant.
//
// Spec 15 — variant "socio-proposal" (nouveau, création seulement — `product` toujours absent dans
// ce variant) : mêmes champs, même gating par type (délégué à ProductTypeFields, extrait de ce
// fichier pour être aussi consommé par ModerateProductCreationProposalForm côté admin — décision
// Jérôme "extraire plutôt que dupliquer", cf. journal 2026-08-17). Photos du produit incluses dès
// la proposition (StagedProductPhotos, révision Jérôme du même jour — cf. cahier des charges socio
// §3e "jusqu'à 6 photos") : uploadées immédiatement vers Storage (même Route Handler qu'admin-
// direct), seul storage_path traverse la proposition, rattachées à product_media par
// create_product_from_proposal à l'approbation. Seules différences restantes avec le variant
// admin : (1) HotelRoomsEditor sans son bloc photo par chambre (room_types.photos toujours hors
// périmètre, cf. spec 15 §10) ; (2) écriture via RPC (proposition modérée) au lieu d'un insert
// direct, TagsMultiSelect sans création de tag à la volée (catalog_tags reste en écriture
// admin-only).
export function ProductForm({
  establishments = [],
  initialEstablishmentId = "",
  allTags = [],
  product,
  variant = "admin",
}: {
  establishments?: Establishment[];
  initialEstablishmentId?: string;
  allTags?: TagOption[];
  product?: EditableProduct;
  variant?: "admin" | "socio-proposal";
}) {
  const router = useRouter();
  const isEditing = Boolean(product);

  const [establishmentId, setEstablishmentId] = useState(initialEstablishmentId);
  const [type, setType] = useState<ProductType>((product?.type as ProductType) ?? "activity");
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(product?.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(product?.description) ?? {}),
  }));

  const fields = useProductTypeFieldsState(
    product
      ? {
          address: product.address,
          lat: product.lat,
          lon: product.lon,
          priceCop: product.price_cop,
          priceTiers: product.price_tiers,
          minQty: product.min_qty,
          maxQty: product.max_qty,
          checkInTime: product.check_in_time,
          checkOutTime: product.check_out_time,
          capacity: product.capacity,
          unitCount: product.unit_count,
          defaultCapacity: product.default_capacity,
          stayRates: product.stay_rates,
          lobbyCategoryId: product.lobby_category_id,
          lobbyProductId: product.lobby_product_id,
        }
      : undefined,
  );
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    isEvento, isCamp, isActivity, isLodging, isHotel, isTransport,
    hasLocationAndTags, hasPriceQtyFields, hasCheckInOut, hasDefaultCapacity,
  } = productTypeGating(type);

  // Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — en édition, le statut vient directement
  // du produit (join établissement fait par la page appelante) ; en création, de l'établissement
  // actuellement sélectionné dans le combobox ci-dessous.
  const selectedEstablishment = establishments.find((item) => item.id === establishmentId);
  const establishmentLobbyConnected = isEditing
    ? Boolean(product?.lobby_connector_active && product?.lobby_has_token)
    : Boolean(selectedEstablishment?.lobby_connector_active && selectedEstablishment?.lobby_has_token);
  const activeEstablishmentId = isEditing ? product?.establishment_id : establishmentId;
  // Arbitrage Jérôme du 2026-08-26 — « import à la liaison ». Lobby PROPOSE, hifago fait foi :
  // on recopie une fois ce que Lobby sait de la catégorie, puis tout reste éditable ici. On n'écrit
  // JAMAIS un champ que Lobby ne renseigne pas — sinon un compte Lobby sans description effacerait
  // une description saisie à la main. Le nom, lui, n'est rempli que s'il est encore vide : c'est
  // l'identité publique du produit (elle porte le slug), jamais quelque chose qu'on écrase.
  async function applyLobbyRoomData(data: LobbyRoomOption) {
    const importedDescription: Record<string, string> = {};
    if (data.descriptions.es) importedDescription.es = data.descriptions.es;
    if (data.descriptions.en) importedDescription.en = data.descriptions.en;
    if (Object.keys(importedDescription).length > 0) {
      setDescription((current) => ({ ...current, ...importedDescription }));
    }
    if (data.capacity !== null) fields.setCapacity(String(data.capacity));
    // `quantity` (2026-08-26) : Lobby le renseigne sur les 6 catégories réelles de Casa Kayam
    // (spec 24 §11.1). Il était parsé et affiché dans la carte depuis le 25/08, puis jeté faute de
    // colonne d'accueil — elle existe depuis la migration 20260826190000.
    if (data.quantity !== null) fields.setUnitCount(String(data.quantity));
    setName((current) => (current.es?.trim() ? current : { ...current, es: data.name }));

    // Les photos ne peuvent pas être « recopiées » comme un texte : il faut aller les chercher chez
    // Lobby côté serveur (téléchargement, décodage, réécriture dans Storage), ce qu'un formulaire
    // navigateur ne sait pas faire. Retour Jérôme du 2026-08-26 — « à la proposition il faut les
    // lier les images » : en création/proposition le produit n'existe pas encore, la route renvoie
    // donc des storage_path qu'on range dans les photos EN ATTENTE. Elles voyagent alors dans
    // payload.photos[] et sont rattachées à l'approbation par create_product_from_proposal, comme
    // n'importe quelle photo uploadée à la main. En édition, c'est ImportLobbyPhotosBlock (admin,
    // produit existant) qui s'en charge — jamais ce chemin, d'où la sortie anticipée.
    if (isEditing || !activeEstablishmentId || data.photoUrls.length === 0) return;

    try {
      const response = await fetch("/api/pms/import-room-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          establishmentId: activeEstablishmentId,
          categoryId: data.id,
          alreadyStaged: stagedPhotos.length,
        }),
      });
      const result = (await response.json()) as
        | { ok: true; photos: StagedPhoto[]; reason?: string }
        | { ok: false; reason: string };

      if (!result.ok) {
        toast.danger("No se pudieron importar las fotos de LobbyPMS.");
        return;
      }
      if (result.photos.length === 0) {
        // Lobby n'a pas de photo : la carte de prévisualisation le dit déjà, inutile d'en remettre
        // une couche. Une galerie pleine, en revanche, est une raison qu'il faut nommer.
        if (result.reason === "gallery_full") toast.danger("La galería ya tiene 6 fotos.");
        return;
      }
      setStagedPhotos((current) => [...current, ...result.photos]);
      toast.success(`${result.photos.length} foto(s) importada(s) de LobbyPMS.`);
    } catch {
      toast.danger("No se pudieron importar las fotos de LobbyPMS.");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nombreEs = name.es?.trim() ?? "";
    const price = Number(fields.priceCop);
    const usesTiers = hasPriceQtyFields && fields.priceMode === "tiers";
    // Un hôtel n'a pas de prix propre (il vit sur ses chambres, product_room_types) — exempté du
    // prix obligatoire comme l'evento, cf. products_price_cop_required_unless_evento (spec 13).
    const needsOwnPrice = !isEvento && !isHotel;

    if (!isEditing) {
      // partner_id n'est jamais saisi indépendamment — dérivé de l'établissement choisi.
      const establishment = establishments.find((item) => item.id === establishmentId);
      if (!establishment || !nombreEs) {
        toast.danger("El nombre (es) y el establecimiento son obligatorios.");
        return;
      }
      if (needsOwnPrice && !usesTiers && (!Number.isFinite(price) || price <= 0)) {
        toast.danger("El precio es obligatorio para este tipo de producto.");
        return;
      }
      if (isEvento && !fields.priceLabel.trim()) {
        toast.danger("El precio en texto libre es obligatorio para un evento.");
        return;
      }
      if (isEvento && !fields.occurrenceDate) {
        toast.danger(
          fields.occurrenceType === "once"
            ? "La fecha es obligatoria para un evento puntual."
            : "La fecha de la primera ocurrencia es obligatoria para un evento recurrente.",
        );
        return;
      }
      if (isEvento && fields.occurrenceType === "recurring" && !fields.recurrenceFrequencyDays) {
        toast.danger("La frecuencia es obligatoria para un evento recurrente.");
        return;
      }
      if (isCamp && (!fields.durationDays || Number(fields.durationDays) < 1)) {
        toast.danger("La duración (días) es obligatoria para un campamento.");
        return;
      }
      if (isActivity) {
        const slotRulesError = validateSlotRules(fields.slotRules);
        if (slotRulesError) {
          toast.danger(slotRulesError);
          return;
        }
      }
      if (isHotel) {
        const roomsError = validateRoomTypes(fields.hotelRooms);
        if (roomsError) {
          toast.danger(roomsError);
          return;
        }
      }
    } else if (!nombreEs) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    } else if (needsOwnPrice && !usesTiers && (!Number.isFinite(price) || price <= 0)) {
      toast.danger("El precio es obligatorio para este tipo de producto.");
      return;
    }

    if (usesTiers) {
      const tiersError = validatePriceTiers(fields.priceTiers);
      if (tiersError) {
        toast.danger(tiersError);
        return;
      }
    }
    if (hasPriceQtyFields && fields.minQty.trim() && fields.maxQty.trim() && Number(fields.minQty) > Number(fields.maxQty)) {
      toast.danger("La cantidad mínima no puede ser mayor a la máxima.");
      return;
    }
    if (isLodging) {
      if (fields.capacity.trim() && (!Number.isInteger(Number(fields.capacity)) || Number(fields.capacity) <= 0)) {
        toast.danger("La capacidad (número de couchage) debe ser un número entero mayor a 0.");
        return;
      }
      // Même garde que la capacité — products_unit_count_positive refuserait de toute façon la
      // valeur côté base, mais un message clair vaut mieux qu'une erreur SQL remontée brute.
      if (fields.unitCount.trim() && (!Number.isInteger(Number(fields.unitCount)) || Number(fields.unitCount) <= 0)) {
        toast.danger("La cantidad (habitaciones o camas) debe ser un número entero mayor a 0.");
        return;
      }
      const stayRatesError = validateStayRates(fields.stayRates);
      if (stayRatesError) {
        toast.danger(stayRatesError);
        return;
      }
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const nameJson = buildLocalizedPayload(name) ?? { es: nombreEs };
    const descriptionJson = buildLocalizedPayload(description) ?? null;

    if (isEditing && product) {
      const { error: updateError } = await supabase
        .from("products")
        .update({
          name: nameJson,
          description: descriptionJson,
          ...(hasLocationAndTags
            ? {
                address: fields.address.trim() || null,
                lat: fields.lat.trim() ? Number(fields.lat) : null,
                lon: fields.lon.trim() ? Number(fields.lon) : null,
              }
            : {}),
          price_cop: isHotel ? null : usesTiers ? lowestTierPrice(fields.priceTiers) : price,
          price_tiers: usesTiers ? toPriceTiersColumn(fields.priceTiers) : null,
          ...(hasPriceQtyFields
            ? {
                min_qty: fields.minQty.trim() ? Number(fields.minQty) : null,
                max_qty: fields.maxQty.trim() ? Number(fields.maxQty) : null,
              }
            : {}),
          ...(hasCheckInOut
            ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
            : {}),
          ...(isLodging
            ? {
                capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
                unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
                stay_rates: toStayRatesColumn(fields.stayRates),
                lobby_category_id: fields.lobbyCategoryId.trim() ? Number(fields.lobbyCategoryId) : null,
              }
            : {}),
          ...(isActivity || isTransport
            ? { lobby_product_id: fields.lobbyProductId.trim() ? Number(fields.lobbyProductId) : null }
            : {}),
          ...(hasDefaultCapacity
            ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
            : {}),
        })
        .eq("id", product.id);

      if (updateError) {
        toast.danger("No se pudo guardar la actividad.");
        setIsSubmitting(false);
        return;
      }

      toast.success("Cambios guardados.");
      router.push(`/admin/establishments/${product.establishment_id}`);
      router.refresh();
      return;
    }

    const establishment = establishments.find((item) => item.id === establishmentId)!;

    if (variant === "socio-proposal") {
      const payload = buildProductCreationPayload(type, name, description, fields, stagedPhotos);
      const { data, error: rpcError } = await supabase.rpc("submit_product_creation_proposal", {
        p_establishment_id: establishment.id,
        p_type: type,
        p_payload: payload as Json,
      });

      setIsSubmitting(false);

      const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
      if (rpcError || !result?.ok) {
        toast.danger(
          SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo.",
        );
        return;
      }

      toast.success("Propuesta enviada.");
      // Refonte vue prestataire (2026-08-19) : "Mis actividades" fusionnée dans
      // "/partner/establishment" — cible directe plutôt que "/partner/products" (qui redirige
      // désormais ici, un hop de moins).
      router.push("/partner/establishment");
      router.refresh();
      return;
    }

    const { data: newProduct, error: insertError } = await supabase
      .from("products")
      .insert({
        partner_id: establishment.partner_id,
        establishment_id: establishment.id,
        type,
        name: nameJson,
        description: descriptionJson,
        slug: slugify(nombreEs),
        // sellable non précisé, hérite du défaut colonne (true) : un produit créé directement par
        // l'admin est publié tout de suite, même principe que create_establishment/
        // create_product_from_proposal (retour Jérôme, 2026-08-20) — l'ancien geste de publication
        // séparée (feature 4) est abandonné pour toute création déjà initiée par un admin.
        price_cop: isEvento || isHotel ? null : price,
        duration_days: isCamp ? Number(fields.durationDays) : null,
        ...(isEvento
          ? {
              price_label: fields.priceLabel.trim(),
              occurrence_type: fields.occurrenceType,
              // Ancre nécessaire pour les deux modes désormais (cf. product-type-fields.tsx) — plus
              // seulement "once" : sans elle, un evento récurrent ne peut jamais dire sur quel jour
              // de semaine il tombe.
              occurrence_date: fields.occurrenceDate,
              recurrence_frequency_days:
                fields.occurrenceType === "recurring" ? Number(fields.recurrenceFrequencyDays) : null,
              recurrence_end_date:
                fields.occurrenceType === "recurring" && fields.recurrenceEndKind === "date"
                  ? fields.recurrenceEndDate
                  : null,
              recurrence_end_count:
                fields.occurrenceType === "recurring" && fields.recurrenceEndKind === "count"
                  ? Number(fields.recurrenceEndCount)
                  : null,
              start_time: fields.startTime || null,
              duration_minutes: fields.durationMinutes ? Number(fields.durationMinutes) : null,
              external_booking_url: fields.externalBookingUrl.trim() || null,
            }
          : {}),
        ...(hasLocationAndTags
          ? {
              address: fields.address.trim() || null,
              lat: fields.lat.trim() ? Number(fields.lat) : null,
              lon: fields.lon.trim() ? Number(fields.lon) : null,
            }
          : {}),
        ...(hasPriceQtyFields && fields.priceMode === "tiers"
          ? { price_cop: lowestTierPrice(fields.priceTiers), price_tiers: toPriceTiersColumn(fields.priceTiers) }
          : {}),
        ...(hasPriceQtyFields && fields.minQty.trim() ? { min_qty: Number(fields.minQty) } : {}),
        ...(hasPriceQtyFields && fields.maxQty.trim() ? { max_qty: Number(fields.maxQty) } : {}),
        ...(hasCheckInOut
          ? { check_in_time: fields.checkInTime || null, check_out_time: fields.checkOutTime || null }
          : {}),
        ...(isLodging
          ? {
              capacity: fields.capacity.trim() ? Number(fields.capacity) : null,
              unit_count: fields.unitCount.trim() ? Number(fields.unitCount) : null,
              stay_rates: toStayRatesColumn(fields.stayRates),
              lobby_category_id: fields.lobbyCategoryId.trim() ? Number(fields.lobbyCategoryId) : null,
            }
          : {}),
        ...(isActivity || isTransport
          ? { lobby_product_id: fields.lobbyProductId.trim() ? Number(fields.lobbyProductId) : null }
          : {}),
        ...(hasDefaultCapacity
          ? { default_capacity: fields.defaultCapacity.trim() ? Number(fields.defaultCapacity) : null }
          : {}),
      })
      .select("id")
      .single();

    if (insertError || !newProduct) {
      toast.danger(
        isEvento
          ? "No se pudo crear el evento."
          : isLodging
            ? "No se pudo crear el alojamiento."
            : isHotel
              ? "No se pudo crear el hotel."
              : isTransport
                ? "No se pudo crear el transporte."
                : "No se pudo crear la actividad.",
      );
      setIsSubmitting(false);
      return;
    }

    // Tags/photos/créneaux/chambres : optionnels, jamais bloquants — un échec ici laisse le produit
    // créé sans cette annexe, corrigible depuis l'édition (même discipline que spec 08 §9/spec 04).
    // Les 4 rattachements ne dépendent que de newProduct.id, jamais les uns des autres : lancés en
    // parallèle plutôt qu'en séquence, le temps total tombe au max des 4 au lieu de leur somme.
    await Promise.all([
      (async () => {
        if (fields.selectedTagIds.length === 0) return;
        const { error: tagsError } = await supabase
          .from("product_tag_assignments")
          .insert(fields.selectedTagIds.map((tagId) => ({ product_id: newProduct.id, tag_id: tagId })));
        if (tagsError) {
          toast.danger("El producto se creó, pero los tags no se pudieron asociar.");
        }
      })(),
      (async () => {
        for (const [index, photo] of stagedPhotos.entries()) {
          const { error: mediaError } = await supabase.rpc("add_catalog_media", {
            p_entity_type: "product",
            p_entity_id: newProduct.id,
            p_storage_path: photo.path,
            p_sort: index,
          });
          if (mediaError) {
            toast.danger("El producto se creó, pero una foto no se pudo asociar.");
          }
        }
      })(),
      (async () => {
        if (!isActivity || fields.slotRules.length === 0) return;
        const rows = toSlotRuleRows(fields.slotRules).map((row) => ({ product_id: newProduct.id, ...row }));
        const { error: slotRulesError } = await supabase.from("product_slot_rules").insert(rows);
        if (slotRulesError) {
          toast.danger("El producto se creó, pero los horarios no se pudieron guardar.");
        }
      })(),
      (async () => {
        if (!isHotel) return;
        // Une chambre à la fois (pas un insert en bloc) : son id est nécessaire pour y attacher
        // ses photos stagées juste après, exactement comme le rattachement photos/tags du produit
        // ci-dessus — non-bloquant, un échec sur une chambre n'annule pas les autres.
        for (const [index, room] of fields.hotelRooms.entries()) {
          const row = toRoomTypeRow(room, index);
          const { data: newRoom, error: roomError } = await supabase
            .from("product_room_types")
            .insert({ product_id: newProduct.id, ...row })
            .select("id")
            .single();
          if (roomError || !newRoom) {
            toast.danger("El producto se creó, pero una habitación no se pudo guardar.");
            continue;
          }
          for (const photo of room.photos) {
            const { error: mediaError } = await supabase.rpc("add_catalog_media", {
              p_entity_type: "room_type",
              p_entity_id: newRoom.id,
              p_storage_path: photo.path,
            });
            if (mediaError) {
              toast.danger("El producto se creó, pero una foto de habitación no se pudo asociar.");
            }
          }
        }
      })(),
    ]);

    toast.success(
      isEvento
        ? "Evento creado."
        : isLodging
          ? "Alojamiento creado."
          : isHotel
            ? "Hotel creado."
            : isTransport
              ? "Transporte creado."
              : "Actividad creada.",
    );
    router.push("/admin/establishments");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <LocalizedTextField
        label="Nombre"
        value={name}
        onChange={setName}
        isRequired
        inputName="nombre"
        testIdPrefix="name"
      />

      {!isEditing ? (
        <>
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
                  const resolvedName = asLocalizedField(establishment.name);
                  const label = (resolvedName?.es ?? resolvedName?.en) || establishment.id;
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
          <Select fullWidth value={type} onChange={(value) => value && setType(value as ProductType)}>
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
                <ListBox.Item id="transport" textValue="Transporte">
                  Transporte
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="evento" textValue="Evento (vitrina)">
                  Evento (vitrina)
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="camp" textValue="Campamento">
                  Campamento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="lodging" textValue="Alojamiento">
                  Alojamiento
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {/* « Hotel » retiré de la CRÉATION le 2026-08-26 (décision Jérôme sur le modèle
                    hébergement, cf. docs/specs/24-modele-hebergement-et-surface-lobbypms.md §4).
                    Un hôtel n'est pas une activité : c'est l'ÉTABLISSEMENT. Ses chambres —
                    dortoirs et privées — sont des Alojamientos vendables, un par unité, exactement
                    comme la v1 en production (src/config/properties.js : les products lodging sont
                    « des TYPES DE COUCHAGE à l'intérieur d'une propriété ») et comme LobbyPMS
                    lui-même, qui n'a aucun objet « hôtel » — un jeton = une propriété, puis
                    directement des catégories de chambres.
                    Conséquence pratique immédiate : seul un Alojamiento peut être adossé à
                    LobbyPMS (isPmsBacked = lodging + lobby_category_id), donc proposer « Hotel »
                    ici menait à un produit qu'on ne pouvait ensuite pas connecter.
                    Ce n'est QUE la fermeture à la création : les hôtels existants restent
                    éditables (ce sélecteur n'est pas rendu en édition), product_room_types et la
                    branche room_type de create_order sont intactes. Leur retrait est la suite du
                    chantier (T2/T3 de la spec 24), qui touche la RPC anti-survente et exige une
                    migration de données — jamais dans le même geste. */}
              </ListBox>
            </Select.Popover>
          </Select>
        </>
      ) : null}

      {/* Démasqué le 2026-08-26 (arbitrage Jérôme « import à la liaison »). Ce champ avait été
          masqué pour une chambre liée à Lobby, au motif que descriptions[] faisait doublon — mais
          rien ne lisait jamais ce champ chez Lobby : il était donc masqué ET vide, et la fiche
          publique d'une chambre PMS-backed apparaissait dans le catalogue comme un nom nu, sans
          photo ni description (apps/web/app/[locale]/page.tsx tire son extrait de
          products.description et son image de product_media). Il est désormais PRÉREMPLI depuis
          Lobby via « Usar estos datos », puis éditable. */}
      <LocalizedTextField
        label="Descripción — opcional"
        value={description}
        onChange={setDescription}
        multiline
        testIdPrefix="description"
        fieldTestId="description-textarea"
      />

      <ProductTypeFields
        type={type}
        state={fields}
        showTags={!isEditing}
        showHotelRoomsEditor={!isEditing}
        showSlotRulesEditor={!isEditing}
        allowCreateTags={variant === "admin"}
        establishmentId={activeEstablishmentId}
        establishmentLobbyConnected={establishmentLobbyConnected}
        allowManualLobbyEntry={variant === "admin"}
        onApplyLobbyRoomData={applyLobbyRoomData}
        // Retour Jérôme (2026-08-18) : les chambres/dortoires doivent pouvoir avoir des photos
        // aussi côté socio — les masquer ici était la seule raison pour laquelle elles ne
        // pouvaient jamais en avoir (buildProductCreationPayload transporte désormais ces photos,
        // moderate_product_proposal/create_product_from_proposal les persistent à l'approbation).
        hidePhotosInHotelRooms={false}
        availableTags={allTags}
      />

      {/* Démasqué avec la description ci-dessus, même raison : une chambre liée à Lobby ne pouvait
          structurellement avoir AUCUNE photo — ni locale (bloc masqué), ni importée (rien ne lisait
          photos[]). Sa carte de catalogue s'affichait donc sans image. */}
      {!isEditing ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fotos — opcional</Label>
          <StagedProductPhotos photos={stagedPhotos} onChange={setStagedPhotos} />
        </div>
      ) : null}

      <Button
        type="submit"
        isDisabled={isSubmitting}
        data-testid={
          isEditing
            ? "save-product-button"
            : variant === "socio-proposal"
              ? "submit-product-proposal-button"
              : "create-product-button"
        }
      >
        {isEditing
          ? isSubmitting
            ? "Guardando…"
            : "Guardar cambios"
          : variant === "socio-proposal"
            ? isSubmitting
              ? "Enviando…"
              : "Enviar propuesta"
            : isSubmitting
              ? "Creando…"
              : isEvento
                ? "Crear evento"
                : isLodging
                  ? "Crear alojamiento"
                  : isHotel
                    ? "Crear hotel"
                    : isTransport
                      ? "Crear transporte"
                      : "Crear actividad"}
      </Button>
    </form>
  );
}
