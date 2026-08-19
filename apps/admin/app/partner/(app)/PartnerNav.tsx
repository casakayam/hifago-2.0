"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@hifago/ui";

// Même patron que AdminSidebar.tsx (Feature 27) : Client Component uniquement pour usePathname()
// (surligner le lien actif), le layout parent reste un Server Component (garde inchangée).
const NAV_ITEMS = [
  { href: "/partner", label: "Inicio" },
  { href: "/partner/establishment", label: "Mi establecimiento" },
  { href: "/partner/commissions", label: "Mis comisiones" },
  { href: "/partner/products", label: "Mis actividades" },
  { href: "/partner/reservations", label: "Mis reservas" },
  { href: "/partner/tools", label: "Mi enlace y QR" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/partner") return pathname === "/partner";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PartnerNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación socio"
      data-testid="partner-nav"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-4"
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          data-testid={`partner-nav-link-${item.href.replace(/\//g, "-")}`}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-secondary",
            isActive(pathname, item.href) ? "bg-surface-secondary text-foreground" : "text-muted"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
