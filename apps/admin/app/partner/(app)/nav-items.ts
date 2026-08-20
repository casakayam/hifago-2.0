// Liste partagée entre PartnerNav.tsx (desktop) et PartnerMobileNav.tsx (mobile) — refonte vue
// prestataire (2026-08-19), extraite pour ne jamais laisser les deux diverger. "Mi establecimiento"
// et "Mis actividades" fusionnées en une seule entrée (la vue /partner/establishment affiche
// désormais chaque établissement avec ses activités liées juste dessous).
export const NAV_ITEMS = [
  { href: "/partner", label: "Inicio" },
  { href: "/partner/establishment", label: "Mi establecimiento y actividades" },
  { href: "/partner/commissions", label: "Mis comisiones" },
  { href: "/partner/reservations", label: "Mis reservas" },
  { href: "/partner/tools", label: "Mi enlace y QR" },
  { href: "/partner/account", label: "Mi cuenta" },
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/partner") return pathname === "/partner";
  return pathname === href || pathname.startsWith(`${href}/`);
}
