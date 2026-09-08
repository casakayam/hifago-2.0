"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { enUS, es } from "date-fns/locale";
// ⚠️ `useRouter` vient d'`@/i18n/navigation`, JAMAIS de `next/navigation` (contrôlé par
// scripts/check-i18n-links.sh depuis le 2026-09-07). `localePrefix: "always"` : le routeur nu
// pousserait `/?q=kayak`, une URL sans préfixe de langue — le proxy la rattrape par une
// redirection qui redevine la langue depuis un cookie au lieu de garder celle de la page lue.
// Rien ne casse visiblement, et c'est bien le problème.
import { useRouter } from "@/i18n/navigation";
import {
  SearchPanel,
  type SearchCriteria,
  type SearchPanelLabels,
} from "@/components/organisms/SearchPanel";
import type { SearchSuggestion } from "@/components/organisms/SearchBar";
import { escribirCriterios } from "@/lib/catalog/criterios";
import type { Criterios, SugerenciaCatalogo, TipoOferta } from "@/lib/catalog/tipos";

// L'hôte client du bloc de recherche de l'accueil (2026-09-08, Tranche 1 du lot D —
// docs/specs/28-vitrine-accueil-et-resultats.md §5 « BuscadorInicio — l'hôte client »).
//
// ⚠️ POURQUOI CE FICHIER EXISTE. Les trois props d'action de `SearchPanel` — `onSubmit`,
// `onCriteriaChange`, `onSuggestionSelect` — sont des FONCTIONS. Un Server Component ne peut pas
// les sérialiser : sans cette couche, `page.tsx` ne compile pas. Ce composant est donc la frontière
// RSC de l'écran — il reçoit des props sérialisables (des chaînes, des nombres, un objet de
// libellés déjà traduits), tient l'état du panneau, et navigue.
//
// ⚠️ `"use client"` en ligne 1, et il est obligatoire deux fois plutôt qu'une : ce fichier tient un
// état, et il importe `SearchPanel`, dont tout le sous-arbre tire le barrel `@hifago/ui`
// (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'IL NE FAIT PAS, ET POURQUOI
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// • Il ne traduit rien. Les libellés arrivent résolus de la page (règle i18n : un traducteur
//   next-intl ne traverse pas la frontière RSC).
// • Il ne calcule aucune date. `aujourdIso` est calculé À GUATAPÉ par la page (`todayInBogota()`
//   de `@hifago/domain`) : l'horloge du navigateur d'un visiteur n'a rien à dire sur ce qui est
//   « passé » pour un hôtelier de Guatapé.
// • Il ne CALCULE aucune suggestion : il les demande à `/api/catalogo/sugerencias`, qui appelle
//   `lib/catalog/` — la couche `server-only` reste la seule à parler à Supabase, et cette route est
//   le seul pont possible depuis un champ qui vit dans le navigateur (Tranche 2, 2026-09-08).

export type BuscadorInicioProps = {
  criteriosIniciales: Criterios;
  /** ISO YYYY-MM-DD, calculé À GUATAPÉ par la page via `todayInBogota()` de `@hifago/domain`. */
  aujourdIso: string;
  /** Le code de langue, pour choisir la locale date-fns du calendrier côté client. */
  localeCodigo: "es" | "en";
  /** Déjà traduits par la page. */
  labels: SearchPanelLabels;
  /**
   * Les sections réellement présentes à l'écran, avec leur nombre d'offres — les raccourcis
   * proposés AVANT la première frappe. La page les a déjà : ils ne coûtent aucune requête.
   */
  atajosTipo: { tipo: TipoOferta; total: number }[];
  testId?: string;
};

/** Deux caractères : en dessous, aucune requête n'est lancée (une par frappe, pour rien). */
const MINIMO_CARACTERES = 2;

/** Le temps qu'on laisse à la frappe avant d'interroger le catalogue. */
const ESPERA_MS = 250;

/** Les critères de l'URL, dans la forme qu'attend `SearchPanel`. Pure : même entrée, même sortie. */
function desdeCriterios(criterios: Criterios): SearchCriteria {
  return {
    query: criterios.q ?? "",
    // `leerCriterios` pose toujours les deux dates ensemble ; `fin: null` reste possible par le
    // type de `PlageCalendrier`, et `buscar` en tient compte.
    dates: criterios.desde ? { debut: criterios.desde, fin: criterios.hasta ?? null } : null,
    people: criterios.personas ?? null,
  };
}

export function BuscadorInicio({
  criteriosIniciales,
  aujourdIso,
  localeCodigo,
  labels,
  atajosTipo,
  // Les e2e s'appuient dessus, et la valeur par défaut évite que l'écran doive la répéter.
  testId = "buscador",
}: BuscadorInicioProps) {
  const router = useRouter();
  const t = useTranslations("HomePage");

  // L'état du panneau, dérivé des critères de l'URL : ce qui est écrit dans l'adresse est ce que le
  // visiteur doit relire dans les champs (un lien partagé, un retour depuis une fiche).
  const [criterios, setCriterios] = useState<SearchCriteria>(() =>
    desdeCriterios(criteriosIniciales)
  );

  // ⚠️ RESYNCHRONISATION SUR L'URL (spec 28 §9). Chaque recherche pousse une entrée d'historique,
  // donc le bouton « précédent » du navigateur re-rend la page avec d'AUTRES critères — mais React
  // conserve l'état d'un composant monté, et l'initialiseur de `useState` ne rejoue pas. Sans ce
  // bloc, le visiteur revenait à des résultats qui ne correspondaient plus à ses champs : l'URL et
  // le panneau racontaient deux recherches différentes. La spec le dit en toutes lettres — l'état
  // interne n'est PAS la source de vérité, l'URL l'est.
  //
  // Pattern React « ajuster l'état pendant le rendu » plutôt qu'un `useEffect` : pas de second
  // rendu visible, pas de scintillement des champs.
  //
  // ⚠️ La comparaison porte sur la SIGNATURE de l'URL, jamais sur l'objet `criteriosIniciales`, qui
  // est reconstruit à chaque rendu et donc toujours différent par référence — comparer les objets
  // réinitialiserait le panneau à chaque frappe et effacerait la saisie en cours. Tant que l'URL ne
  // bouge pas, ce que tape le visiteur est intouché.
  const firmaUrl = escribirCriterios(criteriosIniciales);
  const [firmaAplicada, setFirmaAplicada] = useState(firmaUrl);
  if (firmaUrl !== firmaAplicada) {
    setFirmaAplicada(firmaUrl);
    setCriterios(desdeCriterios(criteriosIniciales));
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // LES SUGGESTIONS (Tranche 2)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  const [sugerencias, setSugerencias] = useState<SugerenciaCatalogo[]>([]);
  const consulta = criterios.query.trim();

  useEffect(() => {
    // Sous deux caractères, on n'interroge rien — et on ne vide RIEN non plus.
    //
    // ⚠️ La première rédaction appelait ici `setSugerencias([])`, ce que la règle
    // `react-hooks/set-state-in-effect` refuse à juste titre : poser un état de façon synchrone
    // dans un effet déclenche un rendu en cascade. Et ce vidage ne servait à rien, parce que
    // l'affichage est DÉRIVÉ : `sugerenciasMostradas` reteste le seuil et rend les raccourcis de
    // type dans ce cas. Une liste périmée peut donc rester en mémoire — elle n'atteint jamais
    // l'écran. C'est le « you might not need an effect » de React, appliqué.
    if (consulta.length < MINIMO_CARACTERES) return;

    // ⚠️ Deux garde-fous, et ils ne font pas la même chose. Le minuteur évite UNE REQUÊTE PAR
    // FRAPPE ; l'`AbortController` évite qu'une réponse lente à « kay » arrive APRÈS celle de
    // « kayak » et réécrive la liste avec un résultat périmé — un défaut qui ne se voit qu'en
    // réseau lent et qu'aucun test local ne reproduit.
    const controleur = new AbortController();
    const minuteur = setTimeout(async () => {
      try {
        const reponse = await fetch(
          `/api/catalogo/sugerencias?q=${encodeURIComponent(consulta)}&locale=${localeCodigo}`,
          { signal: controleur.signal }
        );
        if (!reponse.ok) throw new Error(`sugerencias: ${reponse.status}`);
        const cuerpo = (await reponse.json()) as { sugerencias: SugerenciaCatalogo[] };
        setSugerencias(cuerpo.sugerencias);
      } catch (erreur) {
        // Une recherche reste utilisable sans suggestions : `Entrée` soumet toujours le texte tapé,
        // c'est le contrat écrit de `SearchBar`. On dégrade en silence côté visiteur plutôt que de
        // casser le champ — mais jamais en silence côté journal.
        if ((erreur as Error).name !== "AbortError") {
          console.error("[sugerencias] échec de la recherche de suggestions", erreur);
          setSugerencias([]);
        }
      }
    }, ESPERA_MS);

    return () => {
      clearTimeout(minuteur);
      controleur.abort();
    };
  }, [consulta, localeCodigo]);

  // Ce que la barre affiche : les raccourcis de type avant la frappe, les correspondances ensuite.
  // ⚠️ La composition des libellés se fait ICI et pas dans `lib/catalog/` : « Actividad · Casa
  // Kayam » est du texte d'INTERFACE, et la couche de données ne traduit rien (même règle que le
  // texte alternatif des photos, spec 28 §6).
  const sugerenciasMostradas: SearchSuggestion[] = useMemo(() => {
    if (consulta.length < MINIMO_CARACTERES) {
      // Avant la première frappe, une liste vide serait un cul-de-sac : `menuTrigger="focus"` ouvre
      // le popover à la prise de focus, et il n'aurait rien à montrer. Ces raccourcis sont
      // gratuits — la page les a déjà comptés pour rendre ses sections.
      return atajosTipo.map(({ tipo, total }) => ({
        id: `tipo-${tipo}`,
        label: t(`secciones.${tipo}`),
        meta: t("sugerencias.atajoTipo", { count: total }),
        kind: "tipo",
        // ⚠️ Pas de `href`, à dessein. Un raccourci de type ne QUITTE pas la page : il change ses
        // critères. Le faire passer par `onSuggestionSelect` garde `escribirCriterios` seul maître
        // de l'URL — et évite le rechargement complet qu'un `<a href>` provoquerait ici, puisque
        // `SearchBar` rend un vrai lien natif et non le `Link` localisé.
      }));
    }

    return sugerencias.map((sugerencia) => ({
      id: sugerencia.id,
      label: sugerencia.nombre,
      meta: sugerencia.esEstablecimiento
        ? t("sugerencias.metaEstablecimiento")
        : sugerencia.establecimiento
          ? t("sugerencias.metaOferta", {
              tipo: t(`tiposSingular.${sugerencia.tipo}`),
              establecimiento: sugerencia.establecimiento,
            })
          : t("sugerencias.metaOfertaSinLugar", { tipo: t(`tiposSingular.${sugerencia.tipo}`) }),
      kind: sugerencia.esEstablecimiento ? "establecimiento" : "producto",
      // ⚠️ Le préfixe de langue est posé À LA MAIN : `SearchBar` rend l'option en `<a href>` NATIF
      // (`ListBox.Item href=`), pas avec le `Link` de `@/i18n/navigation`. Sans lui, chaque
      // suggestion partirait sur une URL sans langue que le proxy devrait rattraper.
      href: `/${localeCodigo}${sugerencia.href}`,
    }));
  }, [consulta, sugerencias, atajosTipo, localeCodigo, t]);

  function elegirSugerencia(sugerencia: SearchSuggestion) {
    // Une suggestion d'offre ou d'établissement porte un `href` : le lien natif a déjà navigué,
    // il n'y a rien à faire ici. Seuls les raccourcis de type, volontairement sans `href`,
    // atterrissent dans cette branche.
    if (sugerencia.href) return;
    const tipo = sugerencia.id.replace(/^tipo-/, "") as TipoOferta;
    buscar(criterios, tipo);
  }

  /**
   * `tipoElegido` n'est posé que par un raccourci de type : il REMPLACE alors celui de l'URL, sans
   * toucher au reste des critères — le visiteur qui a déjà saisi des dates les garde.
   */
  function buscar(criteria: SearchCriteria, tipoElegido?: TipoOferta) {
    const nuevos: Criterios = {
      // Vide ou blanc = pas de filtre. Jamais `q=""` : deux URL décriraient la même recherche et le
      // canonical auto-référent ne les rassemblerait plus (`lib/catalog/criterios.ts`, règle 2).
      q: criteria.query.trim() || undefined,
      // ⚠️ REPORTÉS TELS QUELS. Le panneau ne gère ni le type d'offre ni le tag ; les laisser
      // tomber ici effacerait EN SILENCE un filtre présent dans l'URL — un visiteur arrivé sur
      // `?tipo=lodging` qui tape « kayak » se retrouverait à chercher dans tout le catalogue.
      tipo: tipoElegido ?? criteriosIniciales.tipo,
      tag: criteriosIniciales.tag,
      personas: criteria.people ?? undefined,
      desde: criteria.dates?.debut,
      // Une seule date choisie décrit une journée (décision du 2026-09-07) : `hasta` retombe sur
      // `desde` plutôt que de laisser une plage à moitié écrite, que `escribirCriterios` jetterait.
      hasta: criteria.dates?.fin ?? criteria.dates?.debut,
    };

    // `escribirCriterios` rend `""` ou `"?q=…"` — jamais `"?"` seul. L'expression donne donc `/`
    // ou `/?q=…`, et le `useRouter` localisé y remet le préfixe de langue. Les `undefined`
    // ci-dessus sont ignorés par lui : rien à filtrer ici.
    router.push(`/${escribirCriterios(nuevos)}`);
  }

  return (
    <SearchPanel
      criteria={criterios}
      onCriteriaChange={setCriterios}
      onSubmit={buscar}
      suggestions={sugerenciasMostradas}
      onSuggestionSelect={elegirSugerencia}
      aujourdIso={aujourdIso}
      // ⚠️ Un objet date-fns n'est pas sérialisable : c'est pour ça que la page passe un CODE de
      // langue et que la traduction en objet se fait ici, du côté client de la frontière.
      locale={localeCodigo === "en" ? enUS : es}
      // ⚠️ `people.valueLabel` ne peut PAS venir de la page : c'est un pluriel accordé sur le
      // nombre choisi (« 1 persona » / « 3 personas »), et ce nombre est un état client. La page
      // fournit tous les autres libellés déjà traduits ; celui-ci se recalcule ici à chaque
      // changement. Sans lui, `PeopleField` affiche le nombre NU sur son déclencheur — un « 3 »
      // seul là où le visiteur attend « 3 personas ».
      labels={{
        ...labels,
        people: {
          ...labels.people,
          valueLabel:
            criterios.people === null
              ? undefined
              : t("personas.valueLabel", { count: criterios.people }),
        },
      }}
      testId={testId}
    />
  );
}
