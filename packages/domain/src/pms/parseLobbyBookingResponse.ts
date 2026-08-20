export interface LobbyBookingSuccess {
  bookingId: number;
  roomId: number | null;
}

// Piège empirique confirmé v1 (docs/3-integrations/lobby_pms_api.md, racine du dépôt) : la
// réponse RÉELLE de POST /api/v1/bookings est { "booking": { "booking_id": N, "room_id": M } },
// PAS { "data": [{ "idBooking": N }] } comme le documente officiellement LobbyPMS — cette dernière
// forme n'a jamais été observée en production. Parser défensivement, ne jamais supposer un format
// garanti (client cahier des charges §5).
export function parseLobbyBookingResponse(body: unknown): LobbyBookingSuccess | null {
  if (typeof body !== "object" || body === null) return null;
  const booking = (body as { booking?: unknown }).booking;
  if (typeof booking !== "object" || booking === null) return null;
  const bookingId = (booking as { booking_id?: unknown }).booking_id;
  if (typeof bookingId !== "number") return null;
  const roomId = (booking as { room_id?: unknown }).room_id;
  return {
    bookingId,
    roomId: typeof roomId === "number" ? roomId : null,
  };
}
