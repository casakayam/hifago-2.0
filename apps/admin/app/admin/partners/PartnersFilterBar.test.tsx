import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PartnersFilterBar } from "./PartnersFilterBar";

// vi.mock factories sont hoistés au tout début du fichier (avant toute déclaration `const`
// top-level) — vi.hoisted() est la façon officielle de partager des mocks entre le factory et les
// tests sans retomber dans la "temporal dead zone" (constaté en écrivant ce test : toastDangerMock
// référencé directement dans le corps du factory @hifago/ui plantait avec "Cannot access before
// initialization", contrairement à pushMock/geocodeAddressMock qui ne sont lus que dans une
// fonction imbriquée jamais appelée avant le rendu).
const { pushMock, geocodeAddressMock, toastDangerMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  geocodeAddressMock: vi.fn(),
  toastDangerMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/address-autocomplete", () => ({
  geocodeAddress: (query: string) => geocodeAddressMock(query),
}));

vi.mock("@hifago/ui", async () => {
  const actual = await vi.importActual<typeof import("@hifago/ui")>("@hifago/ui");
  return { ...actual, toast: { ...actual.toast, danger: toastDangerMock } };
});

// Revue admin partenaires (Jérôme, 2026-08-19) — PartnersFilterBar est le seul point non trivial
// de ce lot (géocodage asynchrone avant navigation, jamais bloquant) : cf. hifago/CLAUDE.md §6.5,
// composant testable sans navigateur/session, logique conditionnelle réelle (succès/échec du
// géocodage). Pas de @testing-library/jest-dom dans ce monorepo — assertions sur des propriétés
// DOM natives, même convention que les autres tests composant du repo.
describe("PartnersFilterBar", () => {
  beforeEach(() => {
    pushMock.mockClear();
    geocodeAddressMock.mockClear();
    toastDangerMock.mockClear();
  });

  it("sans champ localisation → navigue directement avec les filtres classiques, geocodeAddress jamais appelé", async () => {
    render(<PartnersFilterBar values={{}} />);
    fireEvent.change(screen.getByTestId("filter-q"), { target: { value: "Casa Kayam" } });
    fireEvent.click(screen.getByTestId("server-filters-submit"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(pushMock.mock.calls[0][0]).toContain("q=Casa+Kayam");
  });

  it("géocodage réussi → l'URL poussée contient lat/lon/radius_km/location_label", async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 6.2, lon: -75.5, formattedAddress: "Medellín, Colombia" });
    render(<PartnersFilterBar values={{}} />);
    fireEvent.change(screen.getByTestId("filter-location_q"), { target: { value: "Medellín" } });
    fireEvent.click(screen.getByTestId("server-filters-submit"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(geocodeAddressMock).toHaveBeenCalledWith("Medellín");
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("lat=6.2");
    expect(url).toContain("lon=-75.5");
    expect(url).toContain("radius_km=20");
    expect(toastDangerMock).not.toHaveBeenCalled();
  });

  it("géocodage en échec → toast d'erreur, mais navigue quand même avec les autres filtres (jamais bloquant)", async () => {
    geocodeAddressMock.mockResolvedValue(null);
    render(<PartnersFilterBar values={{}} />);
    fireEvent.change(screen.getByTestId("filter-q"), { target: { value: "Casa Kayam" } });
    fireEvent.change(screen.getByTestId("filter-location_q"), { target: { value: "Dirección Inexistente" } });
    fireEvent.click(screen.getByTestId("server-filters-submit"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(toastDangerMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("lat=");
    expect(url).toContain("q=Casa+Kayam");
  });
});
