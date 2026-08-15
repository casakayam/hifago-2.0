// Extrait de app/admin/page.tsx : la règle eslint react-hooks/purity refuse tout appel direct à
// Date.now()/new Date() dans le corps d'un composant (jamais un problème réel ici — un Server
// Component s'exécute une fois par requête — mais le lint ne fait pas la distinction). Un seul
// appel à Date.now() ici, jamais répété par jour dans une boucle appelée depuis le composant.
export function computeDateWindow(windowDays: number) {
  const now = Date.now();
  const since = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = new Date(now).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return { since, todayIso, days };
}
