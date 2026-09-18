import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductAmenitiesBlock } from "./ProductAmenitiesBlock";

// jsdom (cette version) n'implémente pas `CSS.escape` (spec CSSOM), que react-aria appelle en
// interne pour localiser l'item sélectionné du ComboBox (`react-aria/dist/private/selection/
// utils.mjs`) — sans lui, toute sélection au clavier/clic plante avec "Cannot read properties of
// undefined (reading 'escape')". Polyfill standard, pas un contournement du composant testé :
// premier test de ce dépôt à exercer une vraie sélection react-aria ComboBox (`TagsMultiSelect`
// n'a lui-même aucun test dédié).
if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
  globalThis.CSS = { ...globalThis.CSS, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

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

describe("ProductAmenitiesBlock", () => {
  it("sélectionner un équipement insère dans product_amenity_assignments", async () => {
    appels.length = 0;
    render(
      <ProductAmenitiesBlock
        productId="prod-1"
        allAmenities={[{ id: "am-1", label: "Baño privado" }]}
        initialAmenityIds={[]}
      />
    );

    const input = screen.getByTestId("amenities-multiselect");
    await userEvent.type(input, "Baño privado");
    await screen.findByRole("option", { name: "Baño privado" });
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(appels[0]).toMatchObject({
      table: "product_amenity_assignments",
      action: "insert",
      payload: [{ product_id: "prod-1", amenity_id: "am-1" }],
    });
  });

  it("n'affiche jamais la sentinelle « + Crear… » — liste fermée", async () => {
    render(<ProductAmenitiesBlock productId="prod-1" allAmenities={[]} initialAmenityIds={[]} />);

    const input = screen.getByTestId("amenities-multiselect");
    await userEvent.type(input, "Algo inexistente");

    expect(screen.queryByText(/\+ Crear/)).toBeNull();
  });
});
