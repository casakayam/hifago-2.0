export interface TtlCache<T> {
  getOrFetch(key: string, fetcher: () => Promise<T>, now?: number): Promise<T>;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

// Cache TTL en mémoire, best-effort — jamais une garantie de correction (la vraie barrière
// anti-survente reste POST /api/pms/reserve-nights, toujours relu à chaud au moment de réserver,
// spec 21 §0). Cache la PROMESSE en vol (pas seulement la valeur résolue) pour coalescer les appels
// concurrents sur la même clé : deux visiteurs qui ouvrent le même mois en même temps ne déclenchent
// qu'un seul aller-retour Lobby. Non partagé entre instances serverless concurrentes — acceptable,
// le cache 60s est "autorisé pour l'affichage", jamais "requis" (spec 21 §0).
export function createTtlCache<T>(ttlMs = 60_000): TtlCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  return {
    async getOrFetch(key, fetcher, now = Date.now()) {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now) {
        return existing.value;
      }

      const value = fetcher();
      entries.set(key, { expiresAt: now + ttlMs, value });
      // Un échec ne doit jamais rester bloqué en cache jusqu'à expiration du TTL — la prochaine
      // requête doit pouvoir retenter immédiatement plutôt que d'attendre 60s sur une erreur
      // transitoire (panne réseau passagère vers Lobby).
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
  };
}
