// ⚠️ TZ forcé à un TROISIÈME fuseau, ni celui de la machine ni Bogota — c'est CE test, et pas
// `scripts/check-timezone.sh`, qui prouve mécaniquement que les heures de départ ne traversent
// jamais un objet Date (le grep du script ne vise que `new Date(...).toLocale` et ne verrait pas un
// `new Date(\`${d}T${h}\`)`). Même discipline que LodgingReservationForm.timezone.test.tsx.
// Se vérifie par MUTATION : introduire un `new Date()` dans toTransportInfoColumns doit faire
// rougir ce fichier (CLAUDE.md §11.20).
process.env.TZ = "Europe/Paris";

import { describe, expect, it } from "vitest";
import {
  emptyTransportInfo,
  toTransportInfoColumns,
  validateTransportInfo,
  type TransportInfoFields,
} from "./transportInfo";

// Un transport complètement renseigné : le bus Aeroturex, qui est littéralement le texte figé
// qu'on sort du code legacy (`public/reservar.js:176` du dépôt parent).
function aeroturex(): TransportInfoFields {
  return {
    contactPhone: "+573001112233",
    firstDepartureTime: "07:00",
    lastDepartureTime: "07:45",
    seatsPerDeparture: "40",
    departureAddress: "Parque de El Poblado, Medellín",
    departureLat: "6.2077",
    departureLon: "-75.5673",
    arrivalAddress: "Parque Principal, Guatapé",
    arrivalLat: "6.2326",
    arrivalLon: "-75.1592",
  };
}

describe("validateTransportInfo", () => {
  it("tout vide est valide — les 9 champs sont optionnels", () => {
    expect(validateTransportInfo(emptyTransportInfo())).toBeNull();
  });

  it("un transport complètement renseigné est valide", () => {
    expect(validateTransportInfo(aeroturex())).toBeNull();
  });

  it("première salida sans dernière → erreur (miroir du CHECK products_transport_departure_pair)", () => {
    expect(
      validateTransportInfo({ ...emptyTransportInfo(), firstDepartureTime: "07:00" }),
    ).toMatch(/juntas/);
  });

  it("dernière salida sans première → erreur", () => {
    expect(
      validateTransportInfo({ ...emptyTransportInfo(), lastDepartureTime: "07:45" }),
    ).toMatch(/juntas/);
  });

  it("dernière salida antérieure à la première → erreur (CHECK products_transport_departure_order)", () => {
    expect(
      validateTransportInfo({ ...aeroturex(), firstDepartureTime: "09:00", lastDepartureTime: "07:00" }),
    ).toMatch(/anterior/);
  });

  // LE cas qui justifie `>=` plutôt que `>` en base, et la divergence délibérée avec
  // product_slot_rules_time_order — un transfert privé part à une heure fixe, point.
  it("première = dernière est VALIDE : une salida unique n'est pas une erreur de saisie", () => {
    expect(
      validateTransportInfo({ ...aeroturex(), firstDepartureTime: "14:00", lastDepartureTime: "14:00" }),
    ).toBeNull();
  });

  it.each(["0", "-3", "2.5", "abc"])("plazas par salida invalides (%s) → erreur", (seats) => {
    expect(validateTransportInfo({ ...aeroturex(), seatsPerDeparture: seats })).toMatch(/entero/);
  });

  it("latitude de salida sans longitude → erreur (CHECK departure_coords_pair)", () => {
    expect(validateTransportInfo({ ...aeroturex(), departureLon: "" })).toMatch(/salida/);
  });

  it("longitude de llegada sans latitude → erreur (CHECK arrival_coords_pair)", () => {
    expect(validateTransportInfo({ ...aeroturex(), arrivalLat: "" })).toMatch(/llegada/);
  });

  it("coordonnées non numériques → erreur", () => {
    expect(validateTransportInfo({ ...aeroturex(), arrivalLat: "nord" })).toMatch(/números/);
  });

  // Le téléphone est OPTIONNEL (« non obligatoire le num et sinon c'est celui de hifago ») : vide,
  // la fiche publique retombe sur le WhatsApp de Hifago, donc la fiche reste contactable.
  it("téléphone vide est valide — le repli Hifago prend le relais", () => {
    expect(validateTransportInfo({ ...aeroturex(), contactPhone: "" })).toBeNull();
  });

  it.each(["300111", "0300111", "+0300111", "573001112233", "+57 300 111 2233"])(
    "téléphone hors format E.164 (%s) → erreur (miroir du CHECK SQL)",
    (tel) => {
      expect(validateTransportInfo({ ...aeroturex(), contactPhone: tel })).toMatch(/internacional/);
    },
  );

  // Une adresse sans coordonnées reste valide : l'admin peut taper l'adresse à la main sans passer
  // par la suggestion Google, et la fiche l'affichera quand même (seul le lien Maps disparaît).
  it("adresse sans coordonnées est valide", () => {
    expect(
      validateTransportInfo({
        ...emptyTransportInfo(),
        departureAddress: "Parque de El Poblado, Medellín",
      }),
    ).toBeNull();
  });
});

describe("toTransportInfoColumns", () => {
  it("tout vide → les 9 colonnes à null, jamais une chaîne vide", () => {
    expect(toTransportInfoColumns(emptyTransportInfo())).toEqual({
      transport_contact_phone: null,
      transport_first_departure_time: null,
      transport_last_departure_time: null,
      transport_seats_per_departure: null,
      transport_departure_address: null,
      transport_departure_lat: null,
      transport_departure_lon: null,
      transport_arrival_address: null,
      transport_arrival_lat: null,
      transport_arrival_lon: null,
    });
  });

  it("convertit les nombres et garde les heures en chaînes \"HH:MM\" opaques", () => {
    expect(toTransportInfoColumns(aeroturex())).toEqual({
      transport_contact_phone: "+573001112233",
      transport_first_departure_time: "07:00",
      transport_last_departure_time: "07:45",
      transport_seats_per_departure: 40,
      transport_departure_address: "Parque de El Poblado, Medellín",
      transport_departure_lat: 6.2077,
      transport_departure_lon: -75.5673,
      transport_arrival_address: "Parque Principal, Guatapé",
      transport_arrival_lat: 6.2326,
      transport_arrival_lon: -75.1592,
    });
  });

  // La garantie anti-fuseau, énoncée comme une assertion et pas comme un commentaire : sous
  // TZ=Europe/Paris, "07:00" ressort "07:00" — aucun décalage, donc aucun Date sur le chemin.
  it("sous TZ=Europe/Paris, une heure de Bogota ressort inchangée", () => {
    expect(process.env.TZ).toBe("Europe/Paris");
    const columns = toTransportInfoColumns({ ...aeroturex(), firstDepartureTime: "00:30" });
    expect(columns.transport_first_departure_time).toBe("00:30");
    expect(typeof columns.transport_first_departure_time).toBe("string");
  });

  it("une adresse en espaces seuls vaut null, pas une chaîne vide", () => {
    const columns = toTransportInfoColumns({ ...emptyTransportInfo(), arrivalAddress: "   " });
    expect(columns.transport_arrival_address).toBeNull();
  });
});
