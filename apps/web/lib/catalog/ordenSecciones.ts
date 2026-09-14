import { ORDEN_SECCIONES, type TipoOferta } from "./tipos";

// Spec 28, Tranche 3 (cahier §2b.5, « règle exacte, arrêtée le 2026-09-07 ») : après un ajout au
// panier, les types ABSENTS du panier passent devant, dans leur ordre habituel ; les types DÉJÀ
// PRÉSENTS tombent à la fin, dans le leur. Le client voit donc toujours d'abord ce qu'il n'a pas
// encore. Choisie CONTRE la variante « suivre le dernier ajout » : c'est une partition STABLE du
// panier entier, jamais une réaction au dernier geste — l'ordre ne doit pas sauter à chaque clic.
//
// Fonction pure, zéro dépendance (comme `tipos.ts`) : testable sans base. Appelée depuis
// `buscarSecciones` (lib/catalog/buscar.ts), jamais depuis un composant — l'ordre vient de la
// couche d'accès (cahier §2a, spec 27 invariant « aucune logique métier dans un `page.tsx` »).
export function ordenarTipos(enCarrito: ReadonlySet<TipoOferta>): TipoOferta[] {
  const ausentes = ORDEN_SECCIONES.filter((tipo) => !enCarrito.has(tipo));
  const presentes = ORDEN_SECCIONES.filter((tipo) => enCarrito.has(tipo));
  return [...ausentes, ...presentes];
}
