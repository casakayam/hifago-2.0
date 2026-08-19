// Helper de date partagé par tout spec e2e qui a besoin d'une date relative à "aujourd'hui" sans
// dépendre de données seedées figées (ex. une nuit d'hôtel, une fenêtre de disponibilité) — évite
// de redéclarer la même fonction de 4 lignes dans chaque fichier de spec.
export function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
