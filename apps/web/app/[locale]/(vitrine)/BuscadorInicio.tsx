"use client";

import { useState } from "react";
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
import { escribirCriterios } from "@/lib/catalog/criterios";
import type { Criterios } from "@/lib/catalog/tipos";

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
// • Il ne cherche aucune suggestion — voir `suggestions={[]}` plus bas.
// • Il ne resynchronise PAS son état sur `criteriosIniciales` après le premier rendu. Conséquence
//   assumée, à ne pas découvrir plus tard : un retour arrière du navigateur re-rend la page avec
//   d'autres critères d'URL, alors que le panneau garde ceux affichés. Corriger ça demanderait de
//   réinitialiser l'état sur un changement de props — et un état réinitialisé pendant que le
//   visiteur tape effacerait sa frappe. Signalé, pas fait.

export type BuscadorInicioProps = {
  criteriosIniciales: Criterios;
  /** ISO YYYY-MM-DD, calculé À GUATAPÉ par la page via `todayInBogota()` de `@hifago/domain`. */
  aujourdIso: string;
  /** Le code de langue, pour choisir la locale date-fns du calendrier côté client. */
  localeCodigo: "es" | "en";
  /** Déjà traduits par la page. */
  labels: SearchPanelLabels;
  testId?: string;
};

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

  function buscar(criteria: SearchCriteria) {
    const nuevos: Criterios = {
      // Vide ou blanc = pas de filtre. Jamais `q=""` : deux URL décriraient la même recherche et le
      // canonical auto-référent ne les rassemblerait plus (`lib/catalog/criterios.ts`, règle 2).
      q: criteria.query.trim() || undefined,
      // ⚠️ REPORTÉS TELS QUELS. Le panneau ne gère ni le type d'offre ni le tag ; les laisser
      // tomber ici effacerait EN SILENCE un filtre présent dans l'URL — un visiteur arrivé sur
      // `?tipo=lodging` qui tape « kayak » se retrouverait à chercher dans tout le catalogue.
      tipo: criteriosIniciales.tipo,
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
      // ⚠️ Aucune suggestion, et c'est volontaire : elles sont la Tranche 2 de la spec 28.
      // `SearchBar` accepte une liste vide par contrat (elle affiche alors son `emptyLabel`), donc
      // rien à bricoler en attendant — et le jour où elles arrivent, seules ces deux lignes bougent.
      suggestions={[]}
      onSuggestionSelect={() => {}}
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
