const copFormatters = new Map<string, Intl.NumberFormat>();

// Formatage monétaire COP partagé (0 décimale) — un seul point de vérité pour l'affichage des
// montants ; le formatter est mémoïsé par locale pour ne pas le reconstruire à chaque rendu de ligne
// de tableau.
export function formatCop(value: number, locale: string = "es"): string {
  let formatter = copFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    });
    copFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
