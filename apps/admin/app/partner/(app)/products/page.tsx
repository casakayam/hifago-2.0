import { redirect } from "next/navigation";

// Refonte vue prestataire (2026-08-19) — "Mis actividades" est désormais fusionnée dans
// "/partner/establishment" (chaque établissement affiche directement ses activités liées, cf.
// EstablishmentStack.tsx). Les sous-routes (/products/new, /products/[id]/edit,
// /products/[id]/availability, etc.) restent inchangées : ce sont toujours les cibles réelles des
// CTA de la nouvelle vue fusionnée, seule cette liste devient un simple redirect.
export default function PartnerProductsPage() {
  redirect("/partner/establishment");
}
