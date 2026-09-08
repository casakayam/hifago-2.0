"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// LA FRONTIÈRE D'ERREUR DE LA ZONE VITRINE (spec 27 § « Cas limites », spec 28 §9 — 2026-09-08).
//
// POURQUOI ELLE EXISTE. `lib/catalog/` lève franchement quand Supabase répond une erreur, et c'est
// une décision : « un catalogue vide rendu comme un catalogue normal est pire qu'une erreur — le
// client croit qu'il n'y a rien à vendre » (spec 27 §9). Mais jusqu'ici cet échec franc rendait la
// page d'erreur NUE de Next : ni traduite, ni habillée, sans en-tête ni pied de page. L'échec était
// donc honnête et illisible à la fois.
//
// ⚠️ `"use client"` n'est pas un choix : Next l'exige de tout `error.tsx`, qui doit s'attacher à une
// frontière d'erreur React côté navigateur. C'est la seule route de cette app qui porte cette
// directive, et c'est pour ça que `scripts/check-design-system.sh` reste satisfait : elle
// n'importe rien de `@hifago/ui` — un `error.tsx` qui monterait HeroUI ne pourrait plus s'afficher
// le jour où c'est justement le rendu de HeroUI qui a échoué.
//
// ⚠️ Elle ne rend PAS la coquille, contrairement à `not-found.tsx`. Un `error.tsx` de groupe est
// rendu À L'INTÉRIEUR du layout de sa zone : l'en-tête et le pied de page sont donc déjà là. Les
// rendre une seconde fois donnerait deux en-têtes — faute invisible au typecheck.
//
// ⚠️ Elle ne pose pas de `<main>` non plus : `PageShell` le fait pour les pages, mais il n'est pas
// importable ici sans risquer de faire échouer l'écran d'erreur lui-même sur le même défaut. Un
// `<main>` nu, aux mêmes classes que la coquille `large`, suffit et reste l'unique `<main>` de la
// page (invariant 11 de la spec 27).

export default function ErrorVitrine({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Common");

  // ⚠️ Le message n'est JAMAIS affiché au visiteur — il peut porter un fragment de requête SQL ou
  // un nom de table. Il part au journal du navigateur, où le `digest` permet de le rapprocher de la
  // trace serveur. Ce que le visiteur lit est un texte traduit, écrit pour lui.
  useEffect(() => {
    console.error("[vitrine] rendu interrompu par une erreur", error);
  }, [error]);

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 p-6 text-center sm:p-8"
      data-testid="error-vitrine"
    >
      <h1 className="text-2xl font-semibold">{t("error.titulo")}</h1>
      <p className="max-w-prose text-muted">{t("error.descripcion")}</p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {/* `reset()` remonte le sous-arbre sans recharger la page : sur une panne passagère de la
            base, c'est un nouvel essai à coût nul, et le visiteur ne perd pas sa position. */}
        <button
          type="button"
          onClick={reset}
          className="min-h-11 underline"
          data-testid="error-vitrine-reintentar"
        >
          {t("error.reintentar")}
        </button>
        <Link href="/" className="min-h-11 underline" data-testid="error-vitrine-volver">
          {t("error.volver")}
        </Link>
      </div>
    </main>
  );
}
