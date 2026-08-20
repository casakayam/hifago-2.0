"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Modal, cn, useOverlayState } from "@hifago/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { buildWhatsAppLink, SUPPORT_WHATSAPP_NUMBER } from "@/lib/whatsapp";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";

const SUPPORT_WHATSAPP_MESSAGE = "Hola Jérome, tengo un problema con mi cuenta de socio. Me puedes ayudar porfa?";

// Refonte vue prestataire (2026-08-19) — PartnerNav.tsx (sidebar desktop) n'avait jusqu'ici aucun
// comportement mobile (gap connu, jamais résolu, cf. hifago/CLAUDE.md §12 "sidebar admin non
// repliée sous md"). Barre `md:hidden` + bottom-sheet HeroUI (`Modal.Container placement="bottom"`)
// — HeroUI v3 n'a pas de composant drawer latéral dédié (vérifié dans les types du package), donc
// bottom-sheet plutôt qu'un composant réinventé hors périmètre du design system. Pas de
// `Modal.Trigger` interne (jamais utilisé ailleurs dans ce projet, cf. ChangeStatusDialog.tsx/
// MarkPaidDialog.tsx) : state local géré comme un dialogue externe habituel, juste auto-contenu ici.
export function PartnerMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const whatsappHref = buildWhatsAppLink(SUPPORT_WHATSAPP_NUMBER, SUPPORT_WHATSAPP_MESSAGE);

  // Ferme le tiroir au clic sur un lien (onClick explicite, avant que la navigation ne parte) —
  // constaté à l'usage réel (capture d'écran) que la seule comparaison pathname/prevPathname
  // pendant le rendu ne suffisait pas ici : le contenu du Modal restait visible, superposé à
  // l'écran suivant, après un clic. Gardé en complément (pas en remplacement) comme filet pour le
  // bouton retour/avant du navigateur, qui ne passe par aucun onClick.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  const state = useOverlayState({ isOpen: open, onOpenChange: setOpen });

  return (
    <div className="flex items-center justify-between border-b border-border p-4 md:hidden">
      <span className="text-sm font-semibold">Hifago socio</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="mobile-nav-trigger"
        onPress={() => setOpen(true)}
      >
        Menú
      </Button>

      <Modal state={state}>
        <Modal.Backdrop>
          <Modal.Container placement="bottom" size="full">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Menú</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`partner-mobile-nav-link-${item.href.replace(/\//g, "-")}`}
                    aria-current={isNavItemActive(pathname, item.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
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
                  data-testid="partner-mobile-nav-whatsapp"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-secondary"
                >
                  WhatsApp Hifago
                </a>
              </Modal.Body>
              <Modal.Footer>
                <LogoutButton className="w-full" data-testid="logout-button-mobile-nav" />
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
