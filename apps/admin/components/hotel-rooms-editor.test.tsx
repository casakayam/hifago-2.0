import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HotelRoomsEditor } from "./hotel-rooms-editor";
import { type DraftRoomType } from "@/lib/products/hotelRooms";

// Composant contrôlé, sans I/O réseau (spec 13) : même harnais que slot-rules-editor.test.tsx —
// plus fidèle qu'un mock d'onChange vérifié en isolation.
function Harness({ initial = [] as DraftRoomType[] }) {
  const [rooms, setRooms] = useState<DraftRoomType[]>(initial);
  return <HotelRoomsEditor rooms={rooms} onChange={setRooms} />;
}

// Pas de @testing-library/jest-dom dans ce monorepo — assertions sur des propriétés DOM natives.
describe("HotelRoomsEditor", () => {
  it("ne montre aucune chambre au départ, seulement le bouton d'ajout", () => {
    render(<Harness />);
    expect(screen.queryByTestId("hotel-rooms-editor")).not.toBeNull();
    expect(screen.queryByTestId("room-capacity-0")).toBeNull();
    expect(screen.queryByTestId("add-room-button")).not.toBeNull();
  });

  it("« + Agregar habitación » ajoute une chambre vide (dortoir, prix simple)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    expect(screen.queryByTestId("room-capacity-0")).not.toBeNull();
    expect(screen.queryByTestId("room-price-input-0")).not.toBeNull();
    expect(screen.queryByTestId("room-price-tiers-editor-0")).toBeNull();
  });

  it("saisir la capacité met à jour la valeur du champ", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    const input = screen.getByTestId("room-capacity-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8" } });
    expect(input.value).toBe("8");
  });

  it("le bouton de bascule affiche les tramos et masque le prix simple", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    fireEvent.click(screen.getByTestId("room-price-mode-toggle-0"));
    expect(screen.queryByTestId("room-price-input-0")).toBeNull();
    expect(screen.queryByTestId("room-price-tiers-editor-0")).not.toBeNull();
    expect(screen.queryByTestId("room-price-tier-min-0-0")).not.toBeNull();
  });

  it("« + Agregar tramo » ajoute un tramo à la chambre correspondante", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    fireEvent.click(screen.getByTestId("room-price-mode-toggle-0"));
    fireEvent.click(screen.getByTestId("add-room-price-tier-0"));
    expect(screen.queryByTestId("room-price-tier-min-0-1")).not.toBeNull();
  });

  it("deux chambres sont indépendantes — modifier l'une ne touche pas l'autre", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    fireEvent.click(screen.getByTestId("add-room-button"));
    fireEvent.change(screen.getByTestId("room-capacity-0"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("room-capacity-1"), { target: { value: "2" } });
    expect((screen.getByTestId("room-capacity-0") as HTMLInputElement).value).toBe("4");
    expect((screen.getByTestId("room-capacity-1") as HTMLInputElement).value).toBe("2");
  });

  it("« Quitar habitación » retire la chambre", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("add-room-button"));
    expect(screen.queryByTestId("room-capacity-0")).not.toBeNull();
    fireEvent.click(screen.getByTestId("remove-room-0"));
    expect(screen.queryByTestId("room-capacity-0")).toBeNull();
  });
});
