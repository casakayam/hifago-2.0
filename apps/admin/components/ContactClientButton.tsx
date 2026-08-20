import { buttonVariants } from "@hifago/ui";
import { buildClientWhatsAppLink, isRealClientEmail } from "@/lib/whatsapp";

// Réutilisé par ReservationsTable.tsx (action de liste) et ReservationActions.tsx (fiche détail) —
// rend null si ni le téléphone ni l'email ne sont exploitables (jamais un bouton mort). Le téléphone
// prime (WhatsApp, canal principal du prestataire, cf. lib/whatsapp.ts) ; l'email n'apparaît que
// s'il n'est pas une sentinelle interne (réservation manuelle walk-in, backfill legacy).
export function ContactClientButton({
  holderName,
  holderPhone,
  holderEmail,
}: {
  holderName: string;
  holderPhone: string | null;
  holderEmail: string | null;
}) {
  const message = `Hola ${holderName}, te escribo de parte de tu reserva en Hifago.`;
  const whatsappHref = buildClientWhatsAppLink(holderPhone, message);
  const hasEmail = isRealClientEmail(holderEmail);

  if (!whatsappHref && !hasEmail) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="contact-client-whatsapp"
        >
          WhatsApp
        </a>
      ) : null}
      {hasEmail ? (
        <a
          href={`mailto:${holderEmail}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="contact-client-email"
        >
          Email
        </a>
      ) : null}
    </div>
  );
}
