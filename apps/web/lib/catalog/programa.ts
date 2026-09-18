import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";

// Programme jour par jour d'un camp (spec 37) — lecture seule, côté vitrine.
//
// La colonne `products.program` est une liste PLATE `[{day, text:{es,en}}]` où plusieurs entrées
// partagent normalement le même `day` (c'est ainsi qu'une journée porte plusieurs lignes). Cette
// fonction fait les deux choses que le composant n'a pas le droit de faire :
//   - regrouper par journée, en préservant l'ordre d'apparition des lignes (c'est cet ordre qui
//     fait foi à l'affichage, pas un tri alphabétique ou temporel) ;
//   - résoudre le JSONB multilingue dans la locale demandée, avec le repli obligatoire vers
//     l'espagnol — `.claude/rules/apps.md` : « un composant qui reçoit ses données d'un Server
//     Component reçoit des chaînes DÉJÀ RÉSOLUES ».
//
// Ne throw jamais : une colonne absente, corrompue ou d'une forme inattendue rend `null`, et la
// fiche s'affiche simplement sans bloc programme — même philosophie que stayRatesFromColumn côté
// admin. Une fiche ne doit pas tomber en 500 parce qu'un JSONB éditorial est mal formé.
export function resolverPrograma(
  valeur: unknown,
  locale: string,
): { dia: number; lineas: string[] }[] | null {
  if (!Array.isArray(valeur)) return null;

  const parJour = new Map<number, string[]>();
  for (const brut of valeur) {
    if (!brut || typeof brut !== "object") continue;
    const entree = brut as { day?: unknown; text?: unknown };
    const dia = Number(entree.day);
    if (!Number.isInteger(dia) || dia < 1) continue;

    const texte = resolveLocalizedField(asLocalizedField(entree.text), locale);
    if (!texte || texte.trim() === "") continue;

    if (!parJour.has(dia)) parJour.set(dia, []);
    parJour.get(dia)!.push(texte.trim());
  }

  if (parJour.size === 0) return null;
  return [...parJour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dia, lineas]) => ({ dia, lineas }));
}
