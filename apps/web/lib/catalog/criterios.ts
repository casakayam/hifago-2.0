// Lecture et écriture des critères de recherche dans l'URL (spec 28 §7).
//
// Partagé par l'accueil et les pages de listing : c'est le SEUL endroit qui connaît le nom des
// paramètres, leur format et leur normalisation. Aucune dépendance à Supabase ni à React — donc
// testable unitairement, sans mock.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEUX RÈGLES QUI NE SE DEVINENT PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. ⚠️ **Aucun paramètre n'échoue jamais.** Un `?personas=abc` rend l'accueil normale, il ne rend
//    pas une 400. Une URL est saisie par des humains, recopiée de travers, et suivie par des
//    robots : transformer un lien mal collé en page cassée donne à un crawler une raison de croire
//    le site instable. Tout ce qui est invalide est IGNORÉ, comme s'il était absent.
//
// 2. ⚠️ **Un paramètre à sa valeur par défaut n'est jamais écrit.** Sinon la même recherche produit
//    plusieurs URL (`?q=kayak` et `?q=kayak&personas=`), et le canonical auto-référent de l'accueil
//    ne les rassemble plus.

import { esTipoOferta, type Criterios } from "./tipos";

/**
 * La forme que Next passe réellement à `searchParams` — PAS un `URLSearchParams`.
 * Une valeur peut être un tableau si le paramètre est répété dans l'URL ; on prend la première.
 */
export type ParamsBrutos = Record<string, string | string[] | undefined>;

const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function primero(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const limpio = bruto?.trim();
  return limpio ? limpio : undefined;
}

function fechaValida(valor: string | undefined): string | undefined {
  if (!valor || !ISO_FECHA.test(valor)) return undefined;

  // `2026-02-31` passe la regex mais n'existe pas : seule une reconstruction le prouve.
  //
  // ⚠️ PAS de `.toISOString().slice(0, 10)` ici, même pour une simple validation de forme : le lint
  // du dépôt l'interdit sans exception (`no-restricted-syntax`, règle de fuseau posée le
  // 2026-08-28), et il a raison de ne pas faire de cas particulier — c'est précisément parce que
  // « ce n'est qu'une validation » que le motif se propage ensuite à des dates métier. On compare
  // donc les composantes une à une, ce qui ne construit aucune date civile.
  const [anio, mes, dia] = valor.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  const existe =
    d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  return existe ? valor : undefined;
}

export function leerCriterios(params: ParamsBrutos): Criterios {
  const criterios: Criterios = {};

  const q = primero(params.q);
  if (q) criterios.q = q;

  const tipo = primero(params.tipo);
  if (tipo && esTipoOferta(tipo)) criterios.tipo = tipo;

  const tag = primero(params.tag);
  if (tag) criterios.tag = tag;

  const personas = Number(primero(params.personas));
  if (Number.isInteger(personas) && personas >= 1) criterios.personas = personas;

  // Les deux dates vont ensemble. Une seule saisie décrit une journée (décision du 2026-09-07 :
  // « tu mets une date ou 2 ») ; une plage inversée est ignorée EN ENTIER plutôt que réparée en
  // silence — réordonner les bornes ferait chercher autre chose que ce qui est écrit dans l'URL.
  const desde = fechaValida(primero(params.desde));
  const hasta = fechaValida(primero(params.hasta));
  if (desde || hasta) {
    const inicio = desde ?? hasta!;
    const fin = hasta ?? desde!;
    if (inicio <= fin) {
      criterios.desde = inicio;
      criterios.hasta = fin;
    }
  }

  return criterios;
}

/** Rend `""` quand il n'y a aucun critère — jamais `"?"` seul, qui fabriquerait une seconde URL. */
export function escribirCriterios(criterios: Criterios): string {
  const params = new URLSearchParams();
  if (criterios.q) params.set("q", criterios.q);
  if (criterios.tipo) params.set("tipo", criterios.tipo);
  if (criterios.tag) params.set("tag", criterios.tag);
  if (criterios.personas && criterios.personas >= 1) params.set("personas", String(criterios.personas));
  if (criterios.desde && criterios.hasta) {
    params.set("desde", criterios.desde);
    params.set("hasta", criterios.hasta);
  }
  const cadena = params.toString();
  return cadena ? `?${cadena}` : "";
}

/** Vrai si au moins un filtre est actif — l'accueil s'en sert pour choisir son état vide. */
export function hayCriterios(criterios: Criterios): boolean {
  return Object.keys(criterios).length > 0;
}
