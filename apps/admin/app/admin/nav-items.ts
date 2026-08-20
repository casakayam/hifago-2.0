import type { AppNavItem } from "@hifago/ui";

// Même patron que apps/admin/app/partner/(app)/nav-items.ts — source unique des liens de nav
// admin, consommée par AppNavShell (sidebar desktop + panneau mobile) ET par
// resolveActiveNavTitle (titre de la barre mobile). Le badge de "Propuestas" garde le testid
// `sidebar-proposals-badge` posé par nav-badge.tsx (supprimé) — asserté verbatim par
// admin-home-navigation.spec.ts, jamais renommer sans mettre ce spec à jour.
export function getAdminNavItems(pendingProposalsCount: number): AppNavItem[] {
  return [
    { href: "/admin", label: "Inicio" },
    { href: "/admin/partners", label: "Partners" },
    { href: "/admin/establishments", label: "Establecimientos" },
    { href: "/admin/orders", label: "Pedidos" },
    { href: "/admin/clients", label: "Clientes" },
    { href: "/admin/products", label: "Catálogo" },
    { href: "/admin/tags", label: "Etiquetas" },
    { href: "/admin/campaigns", label: "Campañas" },
    { href: "/admin/invitations", label: "Invitaciones" },
    {
      href: "/admin/proposals",
      label: "Propuestas",
      badge: pendingProposalsCount,
      badgeTestId: "sidebar-proposals-badge",
    },
    { href: "/admin/reconciliation", label: "Reconciliación" },
    { href: "/admin/ledger", label: "Ledger" },
  ];
}
