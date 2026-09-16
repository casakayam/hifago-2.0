import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TypeNavLink } from "./TypeNavLink";

// Le playground de l'onglet de navigation par type — restylé le 2026-09-15 (texte + soulignement
// additif seul, plus de couleur). Ce qu'on vient juger ici : le signal actif ne dépend pas de la
// seule couleur (règle `.claude/rules/ui.md`) puisqu'il n'y en a plus du tout — juste le
// soulignement. Le comportement de repli à plusieurs items ("Más") se juge dans
// `Affichage/SelectorTipo`, pas ici : un atome isolé ne montre qu'UN onglet.
const meta = {
  title: "Affichage/TypeNavLink",
  component: TypeNavLink,
  parameters: { layout: "padded" },
  args: { label: "Actividades", href: "/actividades", activo: false },
} satisfies Meta<typeof TypeNavLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

export const Activo: Story = {
  args: { activo: true },
};
