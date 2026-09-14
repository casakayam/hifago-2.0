import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TypeBadge } from "./TypeBadge";
import { TypeNavLink } from "./TypeNavLink";
import { Legende } from "../playground/Legende";

// Le playground de l'onglet de navigation par type. Ce qu'on vient juger ici, tous invisibles dans
// un test : la couleur reste identique à `TypeBadge` (déjà affiché sur les cartes de catalogue), le
// signal actif ne dépend pas de la seule couleur (règle `.claude/rules/ui.md`), et les 5 onglets
// tiennent sans faire déborder la page en Mobile 390.
const meta = {
  title: "Affichage/TypeNavLink",
  component: TypeNavLink,
  parameters: { layout: "padded" },
  args: { tipo: "activity", label: "Actividades", href: "/actividades", activo: false },
} satisfies Meta<typeof TypeNavLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

export const Activo: Story = {
  args: { activo: true },
};

const TIPOS = [
  { tipo: "activity" as const, label: "Actividades" },
  { tipo: "lodging" as const, label: "Alojamientos" },
  { tipo: "transport" as const, label: "Transportes" },
  { tipo: "camp" as const, label: "Camps" },
  { tipo: "evento" as const, label: "Eventos" },
];

/** Les 5 types côte à côte, aucun actif — la barre telle qu'elle apparaît sur la home. */
export const CincoTipos: Story = {
  render: () => (
    <nav className="flex flex-wrap gap-2">
      {TIPOS.map(({ tipo, label }) => (
        <TypeNavLink key={tipo} tipo={tipo} label={label} href={`/${tipo}`} activo={false} />
      ))}
    </nav>
  ),
};

/** Les 5 types, avec "Camps" actif — le cas d'une page de listing (ex: /es/camps). */
export const CincoTiposConActivo: Story = {
  render: () => (
    <nav className="flex flex-wrap gap-2">
      {TIPOS.map(({ tipo, label }) => (
        <TypeNavLink key={tipo} tipo={tipo} label={label} href={`/${tipo}`} activo={tipo === "camp"} />
      ))}
    </nav>
  ),
};

/**
 * ⚠️ LA PREUVE VISUELLE — `TypeNavLink` et `TypeBadge` doivent être INDISCERNABLES à l'œil pour un
 * même type : le test unitaire compare déjà les classes, cette story compare le rendu réel. Un
 * badge affiché sur une carte de catalogue et un onglet de cette barre doivent se lire comme "le
 * même type", jamais comme deux teintes proches mais différentes.
 */
export const IdenticoAlBadge: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {TIPOS.map(({ tipo, label }) => (
        <div key={tipo} className="flex flex-col gap-1">
          <Legende>{tipo}</Legende>
          <div className="flex items-center gap-3">
            <TypeBadge type={tipo} label={label} />
            <TypeNavLink tipo={tipo} label={label} href={`/${tipo}`} activo={false} />
          </div>
        </div>
      ))}
    </div>
  ),
};
