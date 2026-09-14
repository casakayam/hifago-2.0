import { notFound } from "next/navigation";

// Next.js ne déclenche `not-found.tsx` d'un segment que sur un `notFound()` explicite APPELÉ
// DEPUIS UNE ROUTE DÉJÀ APPARIÉE — jamais pour une URL qui ne correspond à aucun fichier de route
// (vérifié en réel le 2026-09-14 : `/es/nimportequoi` rendait le 404 nu de Next, pas
// `app/[locale]/not-found.tsx`, alors même que ce fichier prétendait couvrir ce cas). La racine de
// ce dépôt n'a pas de layout non-dynamique (`app/[locale]/layout.tsx` EST le layout racine) donc
// `global-not-found.js` (qui court-circuite tout rendu, y compris la coquille et le provider
// next-intl) n'est pas la bonne réponse ici. Ce catch-all comble l'écart : toute URL sous
// `/[locale]/...` qui ne correspond à aucune page réelle atterrit ici et appelle `notFound()`
// elle-même, ce qui redevient le cas déjà géré par `../not-found.tsx`.
export default function CatchAllInconnu() {
  notFound();
}
