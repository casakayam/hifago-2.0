import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",

  // ⚠️ `alternateLinks` vaut TRUE par défaut dans next-intl (routing/config.js :
  // `alternateLinks: e.alternateLinks ?? !0`). Tant qu'il n'était pas surchargé, le middleware
  // posait sur CHAQUE réponse un en-tête HTTP `Link` portant les hreflang es/en/x-default —
  // des hreflang qu'aucune ligne de ce dépôt ne produisait ni ne contrôlait, en violation
  // silencieuse de hifago/CLAUDE.md §5.2.
  //
  // Deux défauts, pas un seul :
  //  1. ils sont construits depuis `x-forwarded-host`
  //     (middleware/getAlternateLinksHeaderValue.js), donc le même contenu servi par deux hôtes
  //     annonce deux jeux d'alternates différents — exactement ce que le canonical est censé
  //     empêcher ;
  //  2. ils étaient posés AUSSI sur les fiches `noindex` servies en repli JSONB, ce qui contredit
  //     §5.3 : une page dont on déclare qu'elle n'est pas une version linguistique distincte
  //     s'annonçait quand même comme telle.
  //
  // Les hreflang sont désormais portés uniquement par les métadonnées (lib/seo/pageMetadata.ts),
  // où l'on décide explicitement quelles locales sont réellement traduites. Une seule source
  // (spec 26 §10 point B).
  alternateLinks: false,
});
