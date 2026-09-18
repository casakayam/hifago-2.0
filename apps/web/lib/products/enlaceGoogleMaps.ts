import type { LugarTransporte } from "@/lib/catalog/tipos";

// L'URL d'itinéraire Google Maps entre les deux extrémités d'un transport (2026-09-16).
//
// ⚠️ CE N'EST PAS LA GOOGLE ROUTES API, et la distinction compte. C'est une simple URL que le
// visiteur ouvre lui-même : aucun appel serveur, aucune clé, aucun quota, aucun coût. La Routes API
// (`routes.googleapis.com`) reste réservée à l'itinéraire de visite du CRM admin
// (`docs/04-architecture-cible.md` §« Google Routes API »), et n'est branchée nulle part
// aujourd'hui. Ne jamais confondre les deux dans une doc ou un commentaire.
//
// Format documenté et stable des Maps URLs : `dir/?api=1&origin=lat,lng&destination=lat,lng`.
// Les coordonnées plutôt que les adresses : une adresse libre peut être ambiguë ou mal géocodée par
// Maps, alors que les lat/lon viennent déjà du géocodage Google au moment de la saisie admin.
//
// Retourne `null` dès qu'une extrémité manque ses coordonnées : un itinéraire à une seule borne
// n'existe pas. L'appelant n'affiche alors simplement pas le lien — les adresses, elles, restent
// affichées, chaque moitié de la fiche étant indépendante.
export function enlaceItinerarioGoogleMaps(
  salida: LugarTransporte,
  llegada: LugarTransporte,
): string | null {
  if (salida.lat == null || salida.lon == null) return null;
  if (llegada.lat == null || llegada.lon == null) return null;

  const params = new URLSearchParams({
    api: "1",
    origin: `${salida.lat},${salida.lon}`,
    destination: `${llegada.lat},${llegada.lon}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
