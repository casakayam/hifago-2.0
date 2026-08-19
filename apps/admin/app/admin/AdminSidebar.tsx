"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@hifago/ui";

/**
 * Sidebar persistante de /admin (docs/specs/02-admin-accueil-et-navigation.md §5.1) — jusqu'ici
 * aucune nav n'existait nulle part dans apps/admin, plusieurs écrans n'étaient joignables qu'en
 * tapant leur URL. Client Component uniquement pour `usePathname()` (surligner le lien actif) ;
 * le layout parent reste un Server Component (garde d'authentification inchangée).
 */
const NAV_ITEMS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/partners", label: "Partners" },
  { href: "/admin/establishments", label: "Establecimientos" },
  { href: "/admin/orders", label: "Pedidos" },
  { href: "/admin/clients", label: "Clientes" },
  { href: "/admin/products", label: "Catálogo" },
  { href: "/admin/tags", label: "Etiquetas" },
  { href: "/admin/campaigns", label: "Campañas" },
  { href: "/admin/invitations", label: "Invitaciones" },
  { href: "/admin/proposals", label: "Propuestas" },
  { href: "/admin/reconciliation", label: "Reconciliación" },
  { href: "/admin/ledger", label: "Ledger" },
] as const;

const CREATE_ITEMS = [
  { href: "/admin/partners/new", label: "Nuevo partner" },
  { href: "/admin/establishments/new", label: "Nuevo establecimiento" },
  { href: "/admin/invitations/new", label: "Nueva invitación" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación admin"
      data-testid="admin-sidebar"
      className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r-[1px] border-default bg-background p-4"
    >
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-testid={`sidebar-link-${item.href.replace(/\//g, "-")}`}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-secondary",
              isActive(pathname, item.href) ? "bg-accent text-accent-foreground" : "text-muted"
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t-[length:var(--border-width)] border-border pt-4">
        <span className="px-3 text-xs font-medium uppercase tracking-wide text-muted">Crear</span>
        {CREATE_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-testid={`sidebar-create-${item.href.replace(/\//g, "-")}`}
            className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          >
            + {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
