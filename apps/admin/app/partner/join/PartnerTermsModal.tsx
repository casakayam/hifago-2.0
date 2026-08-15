"use client";

import { Button, Modal } from "@hifago/ui";

// Contenu factice (lorem ipsum) en attendant le vrai texte des conditions du rôle partenaire —
// signalé par Jérôme : la case à cocher n'avait jusqu'ici aucun moyen de faire lire ce qu'elle
// engage. Un seul document, commun aux deux chemins d'invitation (référent et prestataire) : rien
// dans le cahier des charges socio §3b ne distingue leurs conditions, pas de raison d'en inventer
// deux versions ici.
const PLACEHOLDER_PARAGRAPHS = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.",
  "Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.",
  "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.",
  "Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est.",
];

export function PartnerTermsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Conditions du rôle partenaire</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto text-sm text-muted">
              <p className="text-foreground">
                Texte provisoire — la version définitive de ce document remplacera ce contenu.
              </p>
              {PLACEHOLDER_PARAGRAPHS.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </Modal.Body>
            <Modal.Footer>
              <Button type="button" onPress={() => onOpenChange(false)} data-testid="close-terms-button">
                Fermer
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
