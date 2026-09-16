// Le petit chevron rotatif d'un déclencheur ouvrant/fermant un panneau (`LanguageSwitcher`,
// `SelectorTipo`) — extrait le 2026-09-15 : la même forme existait EN DOUBLE (une copie par
// composant), et `SelectorTipo` en aurait fait une 3e. `components/README.md` : on ne remonte dans
// `components/` que ce qui sert au moins deux endroits — condition remplie dès la 2e copie.
//
// ⚠️ Ne pas confondre avec le chevron STATIQUE de `DateRangeField.tsx` (`viewBox="0 0 24 24"`, pas
// de prop `ouvert`, pas de rotation) : forme différente, usage différent, volontairement resté à
// part.
export type ChevronProps = {
  ouvert: boolean;
  testId?: string;
};

export function Chevron({ ouvert, testId }: ChevronProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${ouvert ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      data-testid={testId}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}
