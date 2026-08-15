// Mêmes 6 valeurs que la contrainte products_category_check — pas de source dynamique, la liste
// est fixe côté DB. Un seul point de vérité pour les 3 formulaires (admin création/édition,
// modération, proposition socio) qui exposent ce choix.
export const PRODUCT_CATEGORIES = [
  { value: "musica", label: "Música" },
  { value: "arte", label: "Arte" },
  { value: "bienestar", label: "Bienestar" },
  { value: "nautica", label: "Náutica" },
  { value: "adrenalina", label: "Adrenalina" },
  { value: "gastronomia", label: "Gastronomía" },
] as const;

// category est nullable en base ; Base UI Select n'accepte pas de valeur "" pour une SelectItem,
// donc "aucune catégorie" est un sentinel local, jamais persisté tel quel (reconverti en null à
// la soumission).
export const NO_PRODUCT_CATEGORY = "none";
