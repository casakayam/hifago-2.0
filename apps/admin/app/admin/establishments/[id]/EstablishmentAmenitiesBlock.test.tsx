import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EstablishmentAmenitiesBlock } from "./EstablishmentAmenitiesBlock";

// jsdom (cette version) n'implémente pas `CSS.escape` (spec CSSOM), que react-aria appelle en
// interne pour localiser l'item sélectionné du ComboBox (`react-aria/dist/private/selection/
// utils.mjs`) — sans lui, toute sélection au clavier/clic plante avec "Cannot read properties of
// undefined (reading 'escape')". Polyfill standard, pas un contournement du composant testé — même
// polyfill que ProductAmenitiesBlock.test.tsx.
if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
  globalThis.CSS = { ...globalThis.CSS, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

// Même patron de mock que le reste des blocs à sauvegarde immédiate de ce dossier : on intercepte
// exactement ce que le composant appelle (`.from(table).insert(...)`/`.delete().eq().in(...)`),
// rien de plus — pas un mock générique de tout le client.
const appels: { table: string; action: "insert" | "delete"; payload: unknown }[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        appels.push({ table, action: "insert", payload });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          in: (_col: string, ids: string[]) => {
            appels.push({ table, action: "delete", payload: ids });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  }),
}));

describe("EstablishmentAmenitiesBlock", () => {
  it("sélectionner un équipement insère dans establishment_amenity_assignments", async () => {
    appels.length = 0;
    render(
      <EstablishmentAmenitiesBlock
        establishmentId="estab-1"
        allAmenities={[{ id: "am-1", label: "Wifi" }]}
        initialAmenityIds={[]}
      />
    );

    const input = screen.getByTestId("amenities-multiselect");
    await userEvent.type(input, "Wifi");
    await screen.findByRole("option", { name: "Wifi" });
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(appels[0]).toMatchObject({
      table: "establishment_amenity_assignments",
      action: "insert",
      payload: [{ establishment_id: "estab-1", amenity_id: "am-1" }],
    });
  });

  it("n'affiche jamais la sentinelle « + Crear… » — liste fermée", async () => {
    render(
      <EstablishmentAmenitiesBlock establishmentId="estab-1" allAmenities={[]} initialAmenityIds={[]} />
    );

    const input = screen.getByTestId("amenities-multiselect");
    await userEvent.type(input, "Algo inexistente");

    expect(screen.queryByText(/\+ Crear/)).toBeNull();
  });
});
