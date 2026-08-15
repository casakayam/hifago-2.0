"use client";

// Adresse du profil commercial (docs/specs/01-admin-creation-partenaire.md §5) — l'admin tape,
// un vrai widget Google Places (`google.maps.places.PlaceAutocompleteElement`) propose des
// suggestions, en choisir une remplit l'adresse complète ET les coordonnées en un geste. Réutilise
// l'infrastructure déjà décidée côté cahier des charges admin §3e / 00-modele-de-donnees.md
// § Google Maps (même clé que public/admin.js:817-826 en legacy — copiée dans
// apps/admin/.env.local en NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, jamais committée).
//
// PAS `google.maps.places.Autocomplete` (legacy) : vérifié auprès de la doc Google avant d'écrire
// ce fichier — depuis le 2025-03-01, cette classe legacy est refusée à tout projet n'ayant jamais
// servi les Places API avant cette date (message console « is not available to new customers »),
// ce qui est le cas ici (le projet Google Cloud de la clé n'a jamais servi que Geocoding/Directions
// pour les socios en legacy, jamais Places). D'où `PlaceAutocompleteElement`, la classe actuelle
// recommandée par Google (https://developers.google.com/maps/documentation/javascript/place-autocomplete-new).
//
// Construit ici localement à apps/admin (aucun autre écran ne le consomme encore, establishments
// non plus) — pas d'extraction en packages/ par anticipation. No-op silencieux si
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY est absent ou si le script échoue à charger : le champ reste
// simplement absent, jamais un blocage de la création.

export type PlaceSelection = { address: string; lat: number | null; lon: number | null };

type LatLngLike = { lat: () => number; lng: () => number };
type PlaceLike = {
  formattedAddress?: string | null;
  location?: LatLngLike | null;
  fetchFields: (opts: { fields: string[] }) => Promise<{ place: PlaceLike } | void>;
};
type PlacePredictionLike = { toPlace: () => PlaceLike };
type PlaceSelectEvent = Event & { placePrediction?: PlacePredictionLike };
type PlaceAutocompleteElementLike = HTMLElement & {
  includedRegionCodes: string[];
  placeholder: string;
};
type PlacesLibrary = {
  PlaceAutocompleteElement: new () => PlaceAutocompleteElementLike;
};

declare global {
  interface Window {
    google?: {
      maps: {
        importLibrary: (name: "places") => Promise<PlacesLibrary>;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleMapsScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.resolve();
  if (window.google?.maps?.importLibrary) return Promise.resolve();

  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      // libraries=places précharge la bibliothèque ; importLibrary (appelé après coup) reste la
      // façon documentée d'obtenir PlaceAutocompleteElement quel que soit le mode de chargement.
      // Note : `&loading=async` (recommandé par l'avertissement console de Google) casse le
      // montage du widget avec ce chargeur simple par balise <script> — constaté en testant en
      // conditions réelles avant de le garder. Cette combinaison précise (loading=async + import
      // Library dans le onload d'une balise <script> classique, sans le loader bootstrap
      // officiel) exige le snippet d'amorçage dédié de Google, pas seulement le paramètre. Laissé
      // sans `loading=async` : fonctionnel, seul un avertissement de performance en console.
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("google-maps-script-load-failed"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Monte le widget dans `container` (un <div> vide, jamais un <input> HeroUI existant — c'est un
// Web Component qui gère son propre input interne). Retourne une fonction de nettoyage à appeler
// au démontage.
export function mountAddressAutocomplete(
  container: HTMLElement,
  onPlaceSelected: (result: PlaceSelection) => void,
): () => void {
  let cancelled = false;
  let element: PlaceAutocompleteElementLike | null = null;
  let handler: ((event: Event) => void) | null = null;

  loadGoogleMapsScript()
    .then(() => window.google?.maps.importLibrary("places"))
    .then((places) => {
      if (cancelled || !places) return;
      element = new places.PlaceAutocompleteElement();
      element.includedRegionCodes = ["co"]; // même restriction que public/admin.js:821 en legacy
      element.placeholder = "Empieza a escribir una dirección…";
      element.setAttribute("data-testid", "address-autocomplete");
      element.setAttribute("aria-label", "Dirección");

      handler = (event: Event) => {
        const { placePrediction } = event as PlaceSelectEvent;
        if (!placePrediction) return;
        const place = placePrediction.toPlace();
        void place.fetchFields({ fields: ["formattedAddress", "location"] }).then((result) => {
          const resolved = (result && "place" in result ? result.place : place) ?? place;
          onPlaceSelected({
            address: resolved.formattedAddress ?? "",
            lat: resolved.location ? resolved.location.lat() : null,
            lon: resolved.location ? resolved.location.lng() : null,
          });
        });
      };
      element.addEventListener("gmp-select", handler);
      container.appendChild(element);
    })
    .catch((err) => {
      // Script Google injoignable/clé absente : le champ de recherche n'apparaît simplement pas
      // (jamais un blocage de la création). Un warning, pas un throw : à la différence d'une
      // erreur de restriction de referer côté clé (403, logguée par le widget Google lui-même,
      // invisible à ce niveau), celle-ci empêche même le SCRIPT de charger — vaut la peine de le
      // voir en dev.
      console.warn("[address-autocomplete] chargement Google Maps impossible :", err);
    });

  return () => {
    cancelled = true;
    if (element && handler) element.removeEventListener("gmp-select", handler);
    element?.remove();
  };
}
