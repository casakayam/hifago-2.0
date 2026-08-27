"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { SearchableCombobox } from "@/components/searchable-combobox";
import type { LobbyRoomOption, LobbyServiceOption } from "@/lib/pms/lobbyOptions";

// Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — alimente le mode "Elegir de la lista" de
// ProductTypeFields : jamais une saisie libre côté socio (frontière de confiance décidée avec
// Jérôme), seulement un choix dans la VRAIE liste Lobby de l'établissement déjà connecté. Fetch
// côté client vers un Route Handler serveur (jamais un appel direct du navigateur vers Lobby/le
// relais — le token n'est jamais exposé côté client). SearchableCombobox attend value/onChange en
// string (cohérent avec lobbyCategoryId/lobbyProductId, déjà des strings dans
// useProductTypeFieldsState) — la conversion en number n'a lieu qu'à l'écriture (productForm/RPC).
//
// Complété le 2026-08-26 : jusqu'ici, choisir une catégorie ne renvoyait AUCUN retour visuel — ni
// le nom une fois le formulaire rouvert, ni ce que Lobby sait de cette chambre. La fiche publique
// d'une chambre PMS-backed restait donc un nom nu, sans photo ni description. Le endpoint renvoie
// désormais toute la charge utile de GET /rooms (même requête, plus rien de jeté) et ce composant
// l'affiche. Chaque champ est FACULTATIF : la carte doit rester lisible si Lobby n'en renvoie
// aucun — cas réel, 2 des 6 catégories du compte Casa Kayam n'ont ni description ni photo
// (forme observée en préprod le 2026-08-26, consignée dans docs/specs/24 §11).

// Les deux formes viennent de @/lib/pms/lobbyOptions, déclarées UNE fois et partagées avec les
// Route Handlers qui les produisent (/simplify 2026-08-26 : elles étaient écrites deux fois, et
// pouvaient diverger sans erreur de compilation). Réexportées ici parce que product-type-fields.tsx
// et product-form.tsx les importent déjà par ce chemin.
export type { LobbyRoomOption, LobbyServiceOption } from "@/lib/pms/lobbyOptions";

type LobbyOption = LobbyRoomOption | LobbyServiceOption;

function isRoomOption(option: LobbyOption): option is LobbyRoomOption {
  return "photoUrls" in option;
}

const KIND_LABEL: Record<"private" | "dorm", string> = {
  private: "Habitación privada",
  dorm: "Dormitorio",
};

export function LobbyOptionPicker({
  establishmentId,
  kind,
  value,
  onChange,
  testId,
  onApplyRoomData,
  readOnly = false,
}: {
  establishmentId: string;
  kind: "rooms" | "services";
  value: string;
  onChange: (value: string) => void;
  testId: string;
  // Fourni uniquement par les écrans qui peuvent réellement écrire le nom/la description/la
  // capacité du produit (ProductForm). Absent → le bouton "Usar estos datos" ne s'affiche pas,
  // plutôt qu'un bouton qui ne ferait rien. Peut être ASYNCHRONE : depuis le 2026-08-26 il importe
  // aussi les photos, ce qui suppose un aller-retour serveur (cf. product-form.tsx).
  onApplyRoomData?: (data: LobbyRoomOption) => void | Promise<void>;
  // Arbitrage Jérôme du 2026-08-26 : « Desvincular »/« Actualizar » sont admin-only. Le socio DOIT
  // voir à quoi son produit est lié et ce que Lobby en sait — c'était le trou : le bloc n'était pas
  // monté du tout côté socio — mais il ne peut ni rompre ni resynchroniser le lien. Sans ça,
  // l'écran proposerait un geste que submit_product_proposal ne persisterait de toute façon pas
  // (sa whitelist ne contient aucun champ Lobby) : un bouton qui ment.
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<LobbyOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const endpoint = kind === "rooms" ? "/api/pms/lobby-rooms" : "/api/pms/lobby-services";
    fetch(`${endpoint}?establishmentId=${encodeURIComponent(establishmentId)}`)
      .then((response) => response.json())
      .then((result: { ok: boolean; items?: LobbyOption[]; reason?: string }) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(
            result.reason === "pms_not_connected"
              ? "Este establecimiento no está conectado a LobbyPMS."
              : "No se pudo cargar la lista de LobbyPMS. Inténtalo de nuevo."
          );
          return;
        }
        setItems(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la lista de LobbyPMS. Inténtalo de nuevo.");
      });

    return () => {
      cancelled = true;
    };
  }, [establishmentId, kind]);

  const selected = useMemo(
    () => (items ?? []).find((item) => String(item.id) === value) ?? null,
    [items, value]
  );

  if (error) {
    return (
      <p className="text-sm text-danger" data-testid={`${testId}-error`}>
        {error}
      </p>
    );
  }

  if (!items) {
    return (
      <p className="text-sm text-muted" data-testid={`${testId}-loading`}>
        Cargando lista de LobbyPMS…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {readOnly ? null : (
        <SearchableCombobox
          items={items}
          getKey={(item) => String(item.id)}
          getLabel={(item) => item.name}
          value={value || null}
          onChange={(id) => onChange(id ?? "")}
          label={kind === "rooms" ? "Categoría LobbyPMS" : "Servicio LobbyPMS"}
          placeholder="Buscar…"
          testId={testId}
          emptyMessage="Ningún elemento encontrado en LobbyPMS."
        />
      )}

      {/* Une valeur peut être posée sans être dans la liste (ID saisi à la main par un admin, ou
          catégorie supprimée depuis chez Lobby) — le dire plutôt que de n'afficher rien du tout. */}
      {value && !selected ? (
        <p className="text-xs text-warning" data-testid={`${testId}-unknown`}>
          El elemento {value} ya no aparece en la lista de LobbyPMS.
        </p>
      ) : null}

      {selected ? (
        <div
          className="flex flex-col gap-2 rounded-medium border border-default-200 p-3"
          data-testid={`${testId}-preview`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium" data-testid={`${testId}-preview-name`}>
              {selected.name}
            </span>
            <span className="text-xs text-muted">· LobbyPMS #{selected.id}</span>
          </div>

          {isRoomOption(selected) ? (
            <LobbyRoomPreview
              option={selected}
              testId={testId}
              onApply={readOnly ? undefined : onApplyRoomData}
            />
          ) : (
            <LobbyServicePreview option={selected} testId={testId} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function LobbyRoomPreview({
  option,
  testId,
  onApply,
}: {
  option: LobbyRoomOption;
  testId: string;
  onApply?: (data: LobbyRoomOption) => void | Promise<void>;
}) {
  // L'import des photos passe par le serveur (téléchargement chez Lobby + réécriture Storage) et
  // peut prendre plusieurs secondes sur une catégorie qui en porte six. Sans état d'attente, le
  // bouton semble inerte et se fait cliquer plusieurs fois — chaque clic réimportant les mêmes
  // photos jusqu'au plafond.
  const [isApplying, setIsApplying] = useState(false);
  const facts: string[] = [];
  if (option.kind) facts.push(KIND_LABEL[option.kind]);
  else if (option.rawType) facts.push(option.rawType);
  if (option.capacity !== null) facts.push(`${option.capacity} personas`);
  if (option.quantity !== null) facts.push(`${option.quantity} habitaciones de este tipo`);
  if (option.roomLabels.length > 0) facts.push(`Nº ${option.roomLabels.join(", ")}`);

  const description = option.descriptions.es ?? option.descriptions.en ?? null;
  // `quantity` fait partie de ce qu'« Usar estos datos » importe réellement (product-form.tsx) —
  // il manquait ici, si bien qu'une catégorie ne portant QUE la quantité n'obtenait pas le bouton
  // alors qu'elle avait bien une donnée à donner (/simplify 2026-08-26).
  const hasImportableData =
    Boolean(description) ||
    option.capacity !== null ||
    option.quantity !== null ||
    option.photoUrls.length > 0;

  return (
    <>
      {facts.length > 0 ? (
        <p className="text-xs text-muted" data-testid={`${testId}-preview-facts`}>
          {facts.join(" · ")}
        </p>
      ) : null}

      {description ? (
        <p className="text-xs" data-testid={`${testId}-preview-description`}>
          {description}
        </p>
      ) : null}

      {option.photoUrls.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid={`${testId}-preview-photos`}>
          {option.photoUrls.slice(0, 6).map((url) => (
            // eslint-disable-next-line @next/next/no-img-element -- vignette distante LobbyPMS, jamais servie par nous : next/image exigerait de déclarer leur domaine en remotePatterns pour un aperçu admin éphémère
            <img
              key={url}
              src={url}
              alt=""
              className="h-12 w-12 rounded-small object-cover"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}

      {/* Aucun champ rempli côté Lobby : le dire explicitement plutôt que d'afficher une carte
          vide, sinon on laisse croire à un bug d'affichage. */}
      {facts.length === 0 && !description && option.photoUrls.length === 0 ? (
        <p className="text-xs text-muted" data-testid={`${testId}-preview-empty`}>
          LobbyPMS no tiene descripción, fotos ni capacidad para esta categoría.
        </p>
      ) : null}

      {option.unsupportedLangs.length > 0 ? (
        <p className="text-xs text-muted" data-testid={`${testId}-preview-unsupported-langs`}>
          Descripciones en {option.unsupportedLangs.join(", ")} no importadas (idiomas no editables
          aquí).
        </p>
      ) : null}

      {onApply && hasImportableData ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            isDisabled={isApplying}
            onPress={async () => {
              setIsApplying(true);
              try {
                await onApply(option);
              } finally {
                setIsApplying(false);
              }
            }}
            data-testid={`${testId}-apply`}
          >
            {isApplying ? "Importando…" : "Usar estos datos"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function LobbyServicePreview({ option, testId }: { option: LobbyServiceOption; testId: string }) {
  const facts: string[] = [];
  // Prix Lobby affiché à titre indicatif : hifago reste la source du prix de vente, c'est pourquoi
  // il n'y a délibérément aucun bouton pour le recopier dans le champ Precio.
  if (option.valueCop !== null) facts.push(`${formatCop(option.valueCop)} en LobbyPMS`);
  if (option.infiniteInventory === true) facts.push("Stock ilimitado");
  else if (option.stock !== null) facts.push(`Stock: ${option.stock}`);

  return (
    <>
      {facts.length > 0 ? (
        <p className="text-xs text-muted" data-testid={`${testId}-preview-facts`}>
          {facts.join(" · ")}
        </p>
      ) : (
        <p className="text-xs text-muted" data-testid={`${testId}-preview-empty`}>
          LobbyPMS no expone precio ni stock para este servicio.
        </p>
      )}

      {/* Dit une fois pour toutes ce qu'un service Lobby NE contient pas. Constaté en vrai le
          2026-08-26 : un service lié faisait conclure à un import cassé (« ça n'a récupéré ni les
          photos ni la capacité »), alors que GET /api/v1/products ne renvoie QUE
          {service_id, name, value, infinite_inventory, stock} — ces champs n'existent tout
          simplement pas sur cette ressource, quel que soit le compte. Photos, description et
          capacité ne viennent que de GET /rooms, donc d'un alojamiento lié à une catégorie
          (spec 24 §11.3). Sans cette phrase, l'écran laisse croire à une panne. */}
      <p className="text-xs text-muted" data-testid={`${testId}-preview-service-scope`}>
        Un servicio de LobbyPMS solo aporta nombre, precio y stock. Las fotos, la descripción y la
        capacidad se gestionan aquí.
      </p>
    </>
  );
}
