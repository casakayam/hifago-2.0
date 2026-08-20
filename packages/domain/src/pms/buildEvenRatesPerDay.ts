export interface RatePerDay {
  date: string;
  price: number;
}

// Répartit totalCop également sur chaque nuit entre startDate (inclus) et endDate (exclu),
// dernière nuit ajustée pour que la somme corresponde EXACTEMENT à totalCop — l'arrondi ne doit
// jamais faire dériver le total envoyé à Lobby du total déjà facturé côté hifago.
//
// Simplification assumée pour la Tranche 1 (spec 21 §10) : order_lines ne porte pas de
// ventilation nuit par nuit (price_cop/total_cop sont déjà l'agrégat de tout le séjour, cf.
// create_order) — un partage égal est la meilleure approximation disponible sans re-dériver
// resolve_date_price côté Node. Sans conséquence sur le prix facturé au client ni sur la
// commission (toujours calculés exclusivement côté hifago) : Lobby ne sert qu'à l'inventaire et à
// l'enregistrement du booking, jamais au calcul du prix (client cahier des charges §5, « garder la
// maîtrise du calcul de remise côté app »).
export function buildEvenRatesPerDay(startDate: string, endDate: string, totalCop: number): RatePerDay[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (nights <= 0) return [];

  const base = Math.floor(totalCop / nights);
  const remainder = totalCop - base * nights;
  const rates: RatePerDay[] = [];
  for (let i = 0; i < nights; i++) {
    const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    rates.push({
      date: day.toISOString().slice(0, 10),
      price: i === nights - 1 ? base + remainder : base,
    });
  }
  return rates;
}
