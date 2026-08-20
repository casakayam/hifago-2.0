import { describe, expect, it } from "vitest";
import { parseLobbyBookingResponse } from "./parseLobbyBookingResponse";

describe("parseLobbyBookingResponse", () => {
  it("parse la forme RÉELLE observée en production", () => {
    expect(parseLobbyBookingResponse({ booking: { booking_id: 20863344, room_id: 488678 } })).toEqual({
      bookingId: 20863344,
      roomId: 488678,
    });
  });

  it("room_id absent → roomId null, pas une erreur", () => {
    expect(parseLobbyBookingResponse({ booking: { booking_id: 20863344 } })).toEqual({
      bookingId: 20863344,
      roomId: null,
    });
  });

  it("JAMAIS la forme officielle documentée data[].idBooking → null (jamais observée en prod)", () => {
    expect(parseLobbyBookingResponse({ data: [{ idBooking: 955088, idRoom: 90546 }], meta: [] })).toBeNull();
  });

  it.each([null, undefined, "", 42, [], {}, { booking: null }, { booking: "oops" }, { booking: {} }])(
    "forme inattendue %j → null, jamais une exception",
    (body) => {
      expect(parseLobbyBookingResponse(body)).toBeNull();
    }
  );
});
