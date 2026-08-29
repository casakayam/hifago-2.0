import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttlCache";

describe("createTtlCache", () => {
  it("hit avant expiration : la deuxième lecture ne rappelle jamais le fetcher", async () => {
    const cache = createTtlCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValue(42);

    const first = await cache.getOrFetch("2028-09", fetcher, 0);
    const second = await cache.getOrFetch("2028-09", fetcher, 59_999);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("miss après expiration du TTL : rappelle le fetcher", async () => {
    const cache = createTtlCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const first = await cache.getOrFetch("2028-09", fetcher, 0);
    const second = await cache.getOrFetch("2028-09", fetcher, 60_001);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesce deux appels concurrents sur la même clé — un seul aller-retour au fetcher", async () => {
    const cache = createTtlCache<number>(60_000);
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
    const cache = createTtlCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrFetch("2028-09", fetcher, 0)).toBe(1);
    expect(await cache.getOrFetch("2028-10", fetcher, 0)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("un échec n'est jamais mis en cache jusqu'à expiration du TTL — retenté immédiatement", async () => {
    const cache = createTtlCache<number>(60_000);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lobby down")).mockResolvedValueOnce(99);

    await expect(cache.getOrFetch("2028-09", fetcher, 0)).rejects.toThrow("lobby down");
    // Même horodatage "now" que le premier appel (bien avant expiration) — pourtant on retente,
    // parce qu'un échec ne doit jamais rester bloqué en cache.
    const result = await cache.getOrFetch("2028-09", fetcher, 1);

    expect(result).toBe(99);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // ── LA PURGE, ajoutée le 2026-08-28 (D8 de la revue adversariale du lot R1) ─────────────────
  // Le cache ne vidait la Map que sur promesse ROMPUE : une entrée expirée n'était plus jamais
  // resservie, et plus jamais libérée non plus. `size()` existe pour rendre ça vérifiable — sans
  // lui, « expirée » et « purgée » sont indiscernables du dehors (les deux rappellent le fetcher).

  it("une entrée expirée et terminée est PURGÉE, pas seulement ignorée", async () => {
    const cache = createTtlCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValue(1);

    await cache.getOrFetch("2028-09", fetcher, 0);
    await cache.getOrFetch("2028-10", fetcher, 0);
    expect(cache.size()).toBe(2);

    // Une lecture APRÈS expiration : elle déclenche le balayage, qui emporte les deux anciennes.
    // Sans la purge, ce compteur vaudrait 3 — les deux mois de septembre/octobre resteraient
    // retenus pour toujours, avec leur catalogue complet.
    await cache.getOrFetch("2028-11", fetcher, 60_001);
    expect(cache.size()).toBe(1);
  });

  it("le balayage ne retire pas une entrée encore EN VOL, même expirée", async () => {
    // ⚠️ CE QUE CE TEST N'AFFIRME PAS, et c'est important : il n'affirme PAS que la coalescence
    // survit à l'expiration. Elle n'y survit pas, et ne l'a jamais fait — `getOrFetch` traite une
    // entrée expirée comme un défaut, en vol ou non. Une lecture Lobby plus lente que le TTL
    // provoque donc une seconde lecture. C'est une sémantique PRÉEXISTANTE, inchangée par ce lot,
    // et signalée à part : c'est une ruée sur la ressource justement lente.
    //
    // Ce qui est affirmé ici : le balayage laisse l'entrée en place tant qu'elle n'est pas
    // terminée. C'est la même règle que le plafond applique (test suivant), où elle est
    // load-bearing — là, elle est défensive, et les deux doivent rester cohérentes.
    const cache = createTtlCache<number>(60_000);
    let resolveLent: (value: number) => void;
    const lent = vi.fn().mockReturnValue(new Promise<number>((resolve) => (resolveLent = resolve)));
    const rapide = vi.fn().mockResolvedValue(2);

    const enVol = cache.getOrFetch("lente", lent, 0);
    await cache.getOrFetch("autre", rapide, 120_000); // déclenche le balayage
    expect(cache.size()).toBe(2);

    resolveLent!(7);
    expect(await enVol).toBe(7);
  });

  it("le plafond borne une RAFALE, que le balayage ne peut pas borner", async () => {
    // Mille clés distinctes en moins d'une minute sont mille entrées VALIDES : rien à balayer.
    // C'est le seul mécanisme qui protège d'un appelant dont l'espace de clés est large — et un
    // cache partagé ne doit pas dépendre de la prudence de ses appelants.
    const cache = createTtlCache<number>(60_000, 10);
    const fetcher = vi.fn().mockResolvedValue(1);

    for (let i = 0; i < 50; i += 1) {
      await cache.getOrFetch(`cle-${i}`, fetcher, 0);
    }
    expect(cache.size()).toBeLessThanOrEqual(10);
  });

  it("le plafond évince les PLUS ANCIENNES, jamais une entrée en vol — ici c'est load-bearing", async () => {
    // Contrairement au balayage, le plafond peut viser une entrée NON EXPIRÉE : évincer une lecture
    // en cours ferait repartir un appel Lobby pour une clé qu'un autre appelant attend déjà. C'est
    // le seul endroit où le drapeau `settled` change réellement un comportement.
    //
    // ⚠️ La première version de ce test ne prouvait RIEN : elle vérifiait la taille et le compte
    // d'appels sans jamais redemander la clé en vol, donc l'éviction de celle-ci passait inaperçue.
    // Vérifié par mutation — retirer le filtre `settled` doit faire rougir CE test.
    const cache = createTtlCache<number>(60_000, 2);
    let resolveLent: (value: number) => void;
    const lent = vi.fn().mockReturnValue(new Promise<number>((resolve) => (resolveLent = resolve)));
    const rapide = vi.fn().mockResolvedValue(1);

    const enVol = cache.getOrFetch("en-vol", lent, 0); // la PLUS ANCIENNE, donc la première visée
    await cache.getOrFetch("a", rapide, 1);
    await cache.getOrFetch("b", rapide, 2); // dépasse le plafond : une éviction a lieu

    // Toujours dans son TTL et toujours en vol : cette lecture DOIT retrouver la promesse en cours.
    const second = cache.getOrFetch("en-vol", lent, 3);
    resolveLent!(9);
    expect(await enVol).toBe(9);
    expect(await second).toBe(9);
    expect(lent).toHaveBeenCalledTimes(1);
  });

  it("purger ne change JAMAIS une réponse — au pire un défaut de cache, toujours correct", async () => {
    const cache = createTtlCache<number>(60_000, 1);
    const fetcher = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(20).mockResolvedValueOnce(30);

    expect(await cache.getOrFetch("a", fetcher, 0)).toBe(10);
    expect(await cache.getOrFetch("b", fetcher, 0)).toBe(20);
    // "a" a été évincée par le plafond : on la relit, et on relit la VRAIE valeur.
    expect(await cache.getOrFetch("a", fetcher, 0)).toBe(30);
  });
});

// ── 2026-08-29 — la ruée sur la ressource lente. Signalée par la revue du lot cache, tranchée par
// Jérôme : on rejoint l'appel en vol plutôt que de le doubler.
describe("une entrée expirée mais EN VOL est rejointe, jamais doublée", () => {
  it("une lecture plus lente que le TTL ne déclenche qu'UN appel, quel que soit le nombre de visiteurs", async () => {
    const cache = createTtlCache<string>(60_000);
    let appels = 0;
    let debloquer: (valeur: string) => void = () => {};
    const fetcher = () => {
      appels += 1;
      return new Promise<string>((resolve) => {
        debloquer = resolve;
      });
    };

    // t=0 : premier visiteur, l'appel part et ne répond pas.
    const premier = cache.getOrFetch("cle", fetcher, 0);
    // t=90s : le TTL a expiré PENDANT que l'appel est encore en vol. C'est le cas mesuré.
    const deuxieme = cache.getOrFetch("cle", fetcher, 90_000);
    const troisieme = cache.getOrFetch("cle", fetcher, 120_000);

    expect(appels).toBe(1);

    debloquer("catalogue");
    // Les trois reçoivent la MÊME donnée, et elle est fraîche — jamais du périmé resservi.
    expect(await premier).toBe("catalogue");
    expect(await deuxieme).toBe("catalogue");
    expect(await troisieme).toBe("catalogue");
  });

  it("une entrée expirée et TERMINÉE déclenche bien un nouvel appel — on ne sert pas de périmé", async () => {
    const cache = createTtlCache<string>(60_000);
    let appels = 0;
    const fetcher = async () => {
      appels += 1;
      return `lecture-${appels}`;
    };

    expect(await cache.getOrFetch("cle", fetcher, 0)).toBe("lecture-1");
    expect(await cache.getOrFetch("cle", fetcher, 30_000)).toBe("lecture-1"); // encore fraîche
    expect(await cache.getOrFetch("cle", fetcher, 90_000)).toBe("lecture-2"); // expirée ET finie
    expect(appels).toBe(2);
  });

  it("un rejet libère la clé immédiatement — une panne franche reste retentée sans délai", async () => {
    const cache = createTtlCache<string>(60_000);
    let appels = 0;
    const fetcher = async () => {
      appels += 1;
      if (appels === 1) throw new Error("Lobby injoignable");
      return "rétabli";
    };

    await expect(cache.getOrFetch("cle", fetcher, 0)).rejects.toThrow("Lobby injoignable");
    // Même instant, TTL loin d'être écoulé : la clé doit avoir été libérée par le rejet.
    expect(await cache.getOrFetch("cle", fetcher, 1)).toBe("rétabli");
    expect(appels).toBe(2);
  });
});
