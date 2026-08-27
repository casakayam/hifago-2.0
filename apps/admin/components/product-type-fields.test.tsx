import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductTypeFields } from "./product-type-fields";
import { useProductTypeFieldsState, type ProductTypeFieldsInit, type ProductType } from "@/lib/products/useProductTypeFieldsState";

// Refonte parcours produit ↔ LobbyPMS (2026-08-26) — composant purement contrôlé (spec 15).
//
// ⚠️ `lobbyLinkMode` s'initialise à **"picker"** dès qu'un lobby_category_id/lobby_product_id
// préexiste (useProductTypeFieldsState, changé le 2026-08-26 pour afficher le NOM et non l'ID brut).
// Tout scénario qui part d'un id existant monte donc LobbyOptionPicker, dont l'effet appelle
// `fetch`. L'en-tête de ce fichier affirmait le contraire — « pas besoin de mock fetch » — et les
// tests passaient uniquement parce que le `.catch()` du picker avalait l'échec et qu'aucune
// assertion ne visait le picker. Un test qui certifie « aucune I/O » en en faisant une, c'est le
// pire des deux mondes : `fetch` est donc réellement neutralisé ci-dessous.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })),
  );
});

function Harness({
  type,
  init,
  establishmentLobbyConnected = true,
  allowManualLobbyEntry = true,
}: {
  type: ProductType;
  init?: ProductTypeFieldsInit;
  establishmentLobbyConnected?: boolean;
  allowManualLobbyEntry?: boolean;
}) {
  const fields = useProductTypeFieldsState(init);
  return (
    <ProductTypeFields
      type={type}
      state={fields}
      establishmentId="establecimiento-1"
      establishmentLobbyConnected={establishmentLobbyConnected}
      allowManualLobbyEntry={allowManualLobbyEntry}
    />
  );
}

describe("ProductTypeFields — sélecteur LobbyPMS", () => {
  it("n'apparaît pas si l'établissement n'est pas connecté à Lobby", () => {
    render(<Harness type="lodging" establishmentLobbyConnected={false} />);
    expect(screen.queryByTestId("lobby-link-mode-select")).toBeNull();
  });

  it("apparaît pour alojamiento avec un libellé propre à une chambre", () => {
    render(<Harness type="lodging" />);
    expect(screen.getByTestId("lobby-link-mode-select")).toBeTruthy();
    expect(screen.getByText("¿Cómo cargar este alojamiento?")).toBeTruthy();
  });

  it("apparaît pour actividad avec un libellé propre à une activité", () => {
    render(<Harness type="activity" />);
    expect(screen.getByTestId("lobby-link-mode-select")).toBeTruthy();
    expect(screen.getByText("¿Cómo cargar esta actividad?")).toBeTruthy();
  });

  it("apparaît désormais pour transporte (généralisation 2026-08-26)", () => {
    render(<Harness type="transport" />);
    expect(screen.getByTestId("lobby-link-mode-select")).toBeTruthy();
    expect(screen.getByText("¿Cómo cargar este transporte?")).toBeTruthy();
  });

  it("n'apparaît jamais pour evento, campamento ou hotel, même connecté (incompatibilité démontrée, pas un oubli)", () => {
    for (const type of ["evento", "camp", "hotel"] as const) {
      const { unmount } = render(<Harness type={type} />);
      expect(screen.queryByTestId("lobby-link-mode-select")).toBeNull();
      unmount();
    }
  });
});

// Renommé et retourné le 2026-08-26 (arbitrage Jérôme « import à la liaison »). La version
// précédente de ce bloc verrouillait le comportement inverse : Capacidad MASQUÉ dès qu'un
// lobby_category_id existait. Ce masquage partait d'une prémisse juste (« ne pas dupliquer ce que
// Lobby fournit ») dont la seconde moitié — aller chercher la valeur chez Lobby — n'avait jamais
// été construite : le champ était donc masqué ET vide, et la fiche publique d'une chambre
// PMS-backed s'affichait sans capacité, sans description et sans photo. Les champs sont désormais
// préremplis depuis Lobby puis éditables ici.
describe("ProductTypeFields — champs d'une chambre liée à LobbyPMS (préremplis, pas masqués)", () => {
  it("sans lobby_category_id : Capacidad visible, aucune note", () => {
    render(<Harness type="lodging" />);
    expect(screen.getByTestId("capacity-input")).toBeTruthy();
    expect(screen.queryByTestId("lobby-room-managed-fields-note")).toBeNull();
  });

  it("avec lobby_category_id déjà présent : Capacidad reste éditable, note affichée", () => {
    render(<Harness type="lodging" init={{ lobbyCategoryId: 9631 }} />);
    expect(screen.getByTestId("capacity-input")).toBeTruthy();
    expect(screen.getByTestId("lobby-room-managed-fields-note")).toBeTruthy();
  });

  // `quantity` (2026-08-26). Deux champs DISTINCTS, c'est tout l'enjeu du test : LobbyPMS renvoie
  // le couple capacity × quantity avec des sens opposés (un dortoir est capacity:1 × quantity:8,
  // huit lits d'une personne), et les confondre inverserait l'information affichée au client.
  it("Cantidad est un champ à part entière, distinct de Capacidad", () => {
    render(<Harness type="lodging" />);
    const capacityInput = screen.getByTestId("capacity-input");
    const unitCountInput = screen.getByTestId("unit-count-input");
    expect(unitCountInput).toBeTruthy();
    expect(unitCountInput).not.toBe(capacityInput);
  });

  it("Cantidad se préremplit depuis la valeur persistée, sans écraser Capacidad", () => {
    render(<Harness type="lodging" init={{ capacity: 1, unitCount: 8 }} />);
    expect((screen.getByTestId("capacity-input") as HTMLInputElement).value).toBe("1");
    expect((screen.getByTestId("unit-count-input") as HTMLInputElement).value).toBe("8");
  });

  it("Cantidad n'existe que pour un logement — jamais pour une activité", () => {
    render(<Harness type="activity" />);
    expect(screen.queryByTestId("unit-count-input")).toBeNull();
  });

  // products.lodging_kind (2026-08-27). Trois valeurs, et une seule des trois ne peut PAS venir
  // d'un import : Lobby ne connaît que privada/compartida. La mention est donc du même ordre que
  // la note ci-dessus — l'écran doit dire ce qu'il fait, sinon on cherche longtemps pourquoi
  // « Usar estos datos » ne remplit jamais « Casa entera ».
  it("Tipo de alojamiento propose les trois natures, dont celle que Lobby n'a pas", () => {
    render(<Harness type="lodging" />);
    const select = screen.getByTestId("lodging-kind-select");
    expect(select).toBeTruthy();
    expect(select.textContent).toContain("Sin especificar");
  });

  it("Tipo de alojamiento se préremplit depuis la valeur persistée", () => {
    render(<Harness type="lodging" init={{ lodgingKind: "whole_house" }} />);
    expect(screen.getByTestId("lodging-kind-select").textContent).toContain("Casa entera");
  });

  it("prévient que « Casa entera » n'existe pas dans LobbyPMS", () => {
    render(<Harness type="lodging" />);
    expect(screen.getByText(/no existe en LobbyPMS/i)).toBeTruthy();
  });

  // Sur un établissement non connecté, la phrase n'aurait aucun sens : elle parle d'un outil que
  // ce partenaire n'utilise pas.
  it("ne parle pas de LobbyPMS à un établissement non connecté", () => {
    render(<Harness type="lodging" establishmentLobbyConnected={false} />);
    expect(screen.getByTestId("lodging-kind-select")).toBeTruthy();
    expect(screen.queryByText(/no existe en LobbyPMS/i)).toBeNull();
  });

  it("Tipo de alojamiento n'existe que pour un logement", () => {
    render(<Harness type="activity" />);
    expect(screen.queryByTestId("lodging-kind-select")).toBeNull();
  });

  it("la note dit ce que l'écran fait vraiment — Lobby gère la disponibilité, pas les champs", () => {
    render(<Harness type="lodging" init={{ lobbyCategoryId: 9631 }} />);
    const note = screen.getByTestId("lobby-room-managed-fields-note").textContent ?? "";
    expect(note).toContain("disponibilidad");
    // Garde-fou contre un retour en arrière partiel : si un jour quelqu'un remasque les champs,
    // il devra aussi réécrire cette phrase — un bloc éditable sous une note qui dit « se gestionan
    // allí, no aquí » est le pire des trois états possibles.
    expect(note).not.toContain("no aquí");
  });

  it("une activité liée à Lobby ne masque rien (Precio/Cupo diario restent hifago)", () => {
    render(<Harness type="activity" init={{ lobbyProductId: 4242 }} />);
    expect(screen.getByTestId("price-input")).toBeTruthy();
    expect(screen.getByTestId("default-capacity-input")).toBeTruthy();
    expect(screen.queryByTestId("lobby-room-managed-fields-note")).toBeNull();
  });

  it("un transporte lié à Lobby ne masque rien non plus", () => {
    render(<Harness type="transport" init={{ lobbyProductId: 5151 }} />);
    expect(screen.getByTestId("price-input")).toBeTruthy();
    expect(screen.getByTestId("default-capacity-input")).toBeTruthy();
  });
});
