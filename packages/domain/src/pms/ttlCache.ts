export interface TtlCache<T> {
  getOrFetch(key: string, fetcher: () => Promise<T>, now?: number): Promise<T>;
  /**
   * Nombre d'entrées retenues. Exposé pour que la purge soit VÉRIFIABLE : sans lui, une entrée
   * expirée et une entrée purgée sont indiscernables de l'extérieur (les deux provoquent un nouvel
   * appel au fetcher), et le défaut corrigé le 2026-08-28 serait resté intestable.
   */
  size(): number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
  /**
   * La promesse a-t-elle fini (tenue ou rompue) ? ⚠️ Une entrée EXPIRÉE MAIS EN VOL ne doit jamais
   * être purgée : elle est la seule chose qui coalesce les appels concurrents, et la jeter ferait
   * partir un second appel Lobby pour la même clé — précisément ce que ce cache existe pour éviter.
   * Le cas n'est pas théorique : une lecture de plage plus lente que le TTL de 60 s expire pendant
   * qu'elle est encore en vol.
   */
  settled: boolean;
}

// Cache TTL en mémoire, best-effort — jamais une garantie de correction (la vraie barrière
// anti-survente reste POST /api/pms/reserve-nights, toujours relu à chaud au moment de réserver,
// spec 21 §0). Cache la PROMESSE en vol (pas seulement la valeur résolue) pour coalescer les appels
// concurrents sur la même clé : deux visiteurs qui ouvrent le même mois en même temps ne déclenchent
// qu'un seul aller-retour Lobby. Non partagé entre instances serverless concurrentes — acceptable,
// le cache 60s est "autorisé pour l'affichage", jamais "requis" (spec 21 §0).
//
// ⚠️ IL NE LIBÉRAIT RIEN, ET C'EST LE DÉFAUT CORRIGÉ LE 2026-08-28 (signalé par la revue
// adversariale du lot R1). La Map n'était vidée que sur promesse ROMPUE : une entrée expirée
// restait indéfiniment, resservie jamais et libérée jamais. Sur un processus serverless de longue
// durée, la mémoire retenue croissait jusqu'à la taille de l'espace de clés — et cet espace est
// choisi par l'APPELANT. Le cas le plus exposé : `/api/pms/night-availability`, route PUBLIQUE et
// ANONYME dont la clé porte le mois demandé (`${établissement}:${mois}`), chaque mois distinct
// retenant un catalogue entier (≈31 nuits × 6 catégories). L'horizon de réservation borne
// aujourd'hui cet espace, mais il vit dans un AUTRE fichier : un cache partagé ne doit pas dépendre
// de la prudence de ses appelants.
//
// Deux mécanismes, et ils ne traitent pas le même risque :
//   - le BALAYAGE retire ce qui est expiré et fini. Il borne la croissance en régime permanent.
//   - le PLAFOND retire les plus anciennes quand tout est encore vivant. Il borne une RAFALE, que
//     le balayage ne peut rien pour : mille clés distinctes en moins d'une minute sont mille
//     entrées valides.
// Aucun des deux ne change une seule réponse : purger revient à provoquer un défaut de cache, et un
// défaut de cache est toujours correct — ce cache n'a qu'une valeur de réduction de charge.
export function createTtlCache<T>(ttlMs = 60_000, maxEntries = 200): TtlCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  // Balayer à CHAQUE lecture coûterait un parcours complet par requête, pour ne rien trouver la
  // plupart du temps : rien n'expire entre deux appels rapprochés. Une fois par TTL suffit, et
  // borne le travail à un parcours par fenêtre de 60 s quel que soit le trafic.
  let lastSweepAt = Number.NEGATIVE_INFINITY;

  function sweep(now: number): void {
    if (now - lastSweepAt < ttlMs) return;
    lastSweepAt = now;
    for (const [key, entry] of entries) {
      if (entry.settled && entry.expiresAt <= now) entries.delete(key);
    }
  }

  function enforceCap(): void {
    if (entries.size <= maxEntries) return;
    // Les plus anciennes d'abord, et JAMAIS une entrée en vol. Si tout est en vol, on dépasse
    // temporairement le plafond plutôt que de casser la coalescence — le dépassement est borné par
    // le nombre d'appels réellement en cours, la coalescence perdue ne l'est pas.
    const evictable = [...entries.entries()]
      .filter(([, entry]) => entry.settled)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of evictable) {
      if (entries.size <= maxEntries) break;
      entries.delete(key);
    }
  }

  return {
    size: () => entries.size,

    async getOrFetch(key, fetcher, now = Date.now()) {
      sweep(now);

      const existing = entries.get(key);
      if (existing && existing.expiresAt > now) {
        return existing.value;
      }

      const value = fetcher();
      const entry: CacheEntry<T> = { expiresAt: now + ttlMs, value, settled: false };
      entries.set(key, entry);
      enforceCap();

      // Un échec ne doit jamais rester bloqué en cache jusqu'à expiration du TTL — la prochaine
      // requête doit pouvoir retenter immédiatement plutôt que d'attendre 60s sur une erreur
      // transitoire (panne réseau passagère vers Lobby). La comparaison porte sur l'ENTRÉE et non
      // sur la clé : une entrée remplacée entre-temps ne doit pas être effacée par le rejet de
      // l'ancienne.
      value.then(
        () => {
          entry.settled = true;
        },
        () => {
          entry.settled = true;
          if (entries.get(key) === entry) entries.delete(key);
        }
      );
      return value;
    },
  };
}
