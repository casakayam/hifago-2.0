"use client";

import { Input, Label, ListBox, Select, TextField } from "@hifago/ui";
import { LobbyOptionPicker, type LobbyRoomOption } from "@/components/lobby-option-picker";
import type { ProductType, ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Refonte parcours produit ↔ LobbyPMS (2026-08-26) — libellé du sélecteur Lobby par type concret
// ("esta actividad"/"este transporte"/"este alojamiento"), jamais une "vinculación" abstraite
// (retour Jérôme : le choix doit parler de la chose créée). Evento/Campamento n'entrent jamais
// dans cette table — le bloc qui la consomme ne se rend pas pour ces types (cf. décision E du plan
// LobbyPMS : evento ne produit jamais d'order_line, camp est incompatible avec le payload
// {productId, qty} sans date d'addLobbyProductService).
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

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — monté par le
// fichier hôte pour lodging/activity/transport (jamais evento/camp, cf. LOBBY_LINK_COPY ci-dessus)
// quand l'établissement est connecté à Lobby. Refonte parcours partenaire ↔ LobbyPMS (2026-08-25,
// réordonnée sur retour Jérôme le même jour — "la page, je te dis de la changer en haut") — ce
// choix vient EN PREMIER dans le fichier hôte, avant adresse/prix/etc. : c'est une bifurcation
// structurante (Lobby vs saisie propre), pas un détail à découvrir en scrollant.
export function LobbyLinkFields({
  type,
  state,
  isLodging,
  isActivity,
  isTransport,
  establishmentId,
  establishmentLobbyConnected,
  allowManualLobbyEntry,
  onApplyLobbyRoomData,
  lobbyLinkReadOnly = false,
}: {
  type: ProductType;
  state: ProductTypeFieldsState;
  isLodging: boolean;
  isActivity: boolean;
  isTransport: boolean;
  establishmentId?: string;
  establishmentLobbyConnected?: boolean;
  allowManualLobbyEntry?: boolean;
  // Arbitrage Jérôme du 2026-08-26 (« import à la liaison ») — fourni uniquement par les écrans qui
  // détiennent réellement le nom et la description du produit (ProductForm). Absent → le bouton
  // « Usar estos datos » ne s'affiche pas, plutôt qu'un bouton sans effet. Asynchrone depuis le
  // 2026-08-26 : le handler réel importe aussi les photos, et le picker l'`await` pour afficher
  // « Importando… ».
  onApplyLobbyRoomData?: (data: LobbyRoomOption) => void | Promise<void>;
  // Arbitrage Jérôme du 2026-08-26 : le socio VOIT le lien, ne le modifie pas (cf. le commentaire
  // de `readOnly` dans lobby-option-picker.tsx).
  lobbyLinkReadOnly?: boolean;
}) {
  // Le déclencheur est "une valeur existe", pas "quel mode du sélecteur est actif" — vrai que l'ID
  // vienne du picker ou d'une saisie admin manuelle. Reste correct depuis que le mode par défaut
  // en édition est passé de "manual" à "picker" (cf. useProductTypeFieldsState), justement parce
  // qu'il ne dépend pas du mode.
  const isRoomLinkedToLobby = isLodging && Boolean(state.lobbyCategoryId.trim());
  const lobbyValue = (isLodging ? state.lobbyCategoryId : state.lobbyProductId).trim();
  const lobbyLinkCopy = LOBBY_LINK_COPY[type];

  if (!((isLodging || isActivity || isTransport) && establishmentLobbyConnected && lobbyLinkCopy)) {
    return null;
  }

  return (
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
          affirmait que capacité/description/photos « se gestionan allí, no aquí » alors qu'aucun
          code ne les lisait chez Lobby : les champs étaient masqués ET vides, donc la fiche
          publique d'une chambre PMS-backed était un nom nu. Ne jamais rétablir une des deux
          moitiés sans l'autre — un bloc photos rendu sous une phrase qui dit le contraire est pire
          que les deux états cohérents. */}
      {isRoomLinkedToLobby ? (
        <p className="text-xs text-muted" data-testid="lobby-room-managed-fields-note">
          LobbyPMS gestiona la disponibilidad de esta habitación. El nombre, la descripción, la
          capacidad y las fotos se copian desde allí al vincular y luego se editan aquí.
        </p>
      ) : null}
    </div>
  );
}
