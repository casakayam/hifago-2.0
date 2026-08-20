"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@hifago/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { buildWhatsAppLink, SUPPORT_WHATSAPP_NUMBER } from "@/lib/whatsapp";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";

// Même patron que AdminSidebar.tsx (Feature 27) : Client Component uniquement pour usePathname()
// (surligner le lien actif), le layout parent reste un Server Component (garde inchangée).
//
// Refonte vue prestataire (2026-08-19) : masquée sous `md` (768px) — remplacée par
// PartnerMobileNav.tsx sur mobile, cf. layout.tsx — et nouvelle entrée "WhatsApp Hifago" (demande
// explicite "dans l'aside"), en plus du raccourci déjà présent sur /partner/tools (pas une
// suppression, un raccourci de plus, même lien wa.me que PartnerCodeEntry.tsx).
const SUPPORT_WHATSAPP_MESSAGE = "Hola Jérome, tengo un problema con mi cuenta de socio. Me puedes ayudar porfa?";

export function PartnerNav() {
  const pathname = usePathname();
  const whatsappHref = buildWhatsAppLink(SUPPORT_WHATSAPP_NUMBER, SUPPORT_WHATSAPP_MESSAGE);

  return (
    <nav
      aria-label="Navegación socio"
      data-testid="partner-nav"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border p-4 md:flex"
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          data-testid={`partner-nav-link-${item.href.replace(/\//g, "-")}`}
          aria-current={isNavItemActive(pathname, item.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-secondary",
            isNavItemActive(pathname, item.href) ? "bg-surface-secondary text-foreground" : "text-muted"
          )}
        >
          {item.label}
        </Link>
      ))}

      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="partner-nav-whatsapp"
        className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-secondary"
      >
        WhatsApp Hifago
      </a>

      <div className="mt-auto border-t border-border pt-4">
        <LogoutButton className="w-full" data-testid="logout-button-nav" />
      </div>
    </nav>
  );
}
