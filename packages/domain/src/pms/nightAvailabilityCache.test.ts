import { describe, expect, it, vi } from "vitest";
import { createNightAvailabilityCache } from "./nightAvailabilityCache";

describe("createNightAvailabilityCache", () => {
  it("hit avant expiration : la deuxième lecture ne rappelle jamais le fetcher", async () => {
    const cache = createNightAvailabilityCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValue(42);

    const first = await cache.getOrFetch("2028-09", fetcher, 0);
    const second = await cache.getOrFetch("2028-09", fetcher, 59_999);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("miss après expiration du TTL : rappelle le fetcher", async () => {
    const cache = createNightAvailabilityCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const first = await cache.getOrFetch("2028-09", fetcher, 0);
    const second = await cache.getOrFetch("2028-09", fetcher, 60_001);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesce deux appels concurrents sur la même clé — un seul aller-retour au fetcher", async () => {
    const cache = createNightAvailabilityCache<number>(60_000);
    let resolveFetch: (value: number) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise<number>((resolve) => (resolveFetch = resolve)));

    const first = cache.getOrFetch("2028-09", fetcher, 0);
    const second = cache.getOrFetch("2028-09", fetcher, 0);
    resolveFetch!(7);

    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clés différentes ne se partagent jamais d'entrée", async () => {
    const cache = createNightAvailabilityCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrFetch("2028-09", fetcher, 0)).toBe(1);
    expect(await cache.getOrFetch("2028-10", fetcher, 0)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("un échec n'est jamais mis en cache jusqu'à expiration du TTL — retenté immédiatement", async () => {
    const cache = createNightAvailabilityCache<number>(60_000);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lobby down")).mockResolvedValueOnce(99);

    await expect(cache.getOrFetch("2028-09", fetcher, 0)).rejects.toThrow("lobby down");
    // Même horodatage "now" que le premier appel (bien avant expiration) — pourtant on retente,
    // parce qu'un échec ne doit jamais rester bloqué en cache.
    const result = await cache.getOrFetch("2028-09", fetcher, 1);

    expect(result).toBe(99);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
