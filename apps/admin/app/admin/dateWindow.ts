import { addDaysIso, todayInBogota } from "@hifago/domain";

// Fenêtre de dates du tableau de bord admin (chiffres du jour, courbe des N derniers jours).
//
// Extrait de app/admin/page.tsx parce que la règle eslint react-hooks/purity refuse tout appel
// direct à Date.now()/new Date() dans le corps d'un composant (jamais un problème réel ici — un
// Server Component s'exécute une fois par requête — mais le lint ne fait pas la distinction).
//
// Lot fuseau (2026-08-28) : les trois dates étaient calculées en UTC. Sur Vercel (serveur en UTC),
// passé 19 h à Guatapé, `todayIso` désignait DEMAIN — le tableau de bord affichait donc les
// chiffres « du jour » sur une journée qui n'avait pas commencé, et la dernière colonne de la
// courbe était vide. C'est l'un des deux écrans que le socio et l'admin ouvrent tous les jours.
export function computeDateWindow(windowDays: number) {
  const todayIso = todayInBogota();
  const since = addDaysIso(todayIso, -windowDays);
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    days.push(addDaysIso(todayIso, -i));
  }
  return { since, todayIso, days };
}
