import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SelectorTipo } from "./SelectorTipo";

// Le playground du sélecteur de type — remplace `SelectorTipoCompacto` (supprimé le 2026-09-15) et
// absorbe les scénarios "5 types ensemble" qui vivaient avant dans `TypeNavLink.stories.tsx` : ce
// n'est plus le rôle d'un atome de démontrer une rangée, c'est exactement ce que ce composant est.
//
// `Desbordado`/`Desplegado` contraignent la largeur du conteneur (`maxWidth`) plutôt que de changer
// le gabarit Storybook : ça rend le repli reproductible indépendamment du viewport choisi dans la
// barre d'outils — la vraie mesure `ResizeObserver` tourne, aucun mock nécessaire ici (contrairement
// à `SelectorTipo.test.tsx`, où jsdom ne fait aucune mise en page réelle).
const TIPOS = [
  { tipo: "activity" as const, label: "Actividades", href: "/actividades" },
  { tipo: "lodging" as const, label: "Alojamientos", href: "/alojamientos" },
  { tipo: "transport" as const, label: "Transportes", href: "/transportes" },
  { tipo: "camp" as const, label: "Camps", href: "/camps" },
  { tipo: "evento" as const, label: "Eventos", href: "/eventos" },
];

const meta = {
  title: "Affichage/SelectorTipo",
  component: SelectorTipo,
  parameters: { layout: "padded" },
  args: {
    tipos: TIPOS,
    etiqueta: "Tipos de oferta",
    masEtiqueta: "Más",
    menosEtiqueta: "Menos",
    testId: "selector-tipos",
  },
} satisfies Meta<typeof SelectorTipo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Les 5 types côte à côte, aucun actif — le cas de la home, à une largeur qui les contient tous. */
export const Defaut: Story = {};

/** Un onglet actif — couvre la prop `tipoActivo`, pour laquelle le composant reste dimensionné
 *  même si plus aucun écran réel ne l'exerce depuis le 2026-09-15 (`SelectorTipo` n'est monté que
 *  par la home, toujours sans `tipoActivo` — les autres écrans qui l'utilisaient avec un type actif
 *  sont repassés à `Migas` seul). Gardée au cas où un futur écran la réutiliserait. */
export const ConActivo: Story = {
  args: { tipoActivo: "camp" },
};

/** Contraint sous 320px : la ligne déborde, "Más" apparaît replié. */
export const Desbordado: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 320 }}><Story /></div>],
};

/** Même contrainte que `Desbordado`, mais "Más" déjà cliqué — la ligne 2 est visible. */
export const Desplegado: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const bouton = canvasElement.querySelector('[data-testid="selector-tipos-mas"]') as HTMLButtonElement | null;
    bouton?.click();
  },
};
