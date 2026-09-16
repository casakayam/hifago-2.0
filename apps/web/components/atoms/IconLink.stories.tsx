import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconLink } from "./IconLink";
import { IconButton } from "./IconButton";
import { Legende } from "../playground/Legende";

// Le lien en icône seule — quatrième membre de la famille des boutons, créé pour le header
// (2026-09-02). Il complète la grille : bouton/lien × libellé visible/icône seule.
//
// ⚠️ Ce que ces stories doivent montrer : qu'il est IDENTIQUE à `IconButton` à l'œil, et pourtant
// différent par nature — il navigue, s'ouvre au clic du milieu, se copie. Un bouton qui navigue
// casse ces trois gestes, et sur une icône de panier ce sont des gestes que les gens font.
const meta = {
  title: "Actions/IconLink",
  component: IconLink,
  parameters: { layout: "padded" },
} satisfies Meta<typeof IconLink>;

export default meta;
type Story = StoryObj<typeof meta>;

const Viaje = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" />
    <path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" />
    <path d="M10 20h4" />
    <circle cx="16" cy="20" r="2" />
    <circle cx="8" cy="20" r="2" />
  </svg>
);

export const Defaut: Story = {
  args: { icon: <Viaje />, label: "Mi viaje, 2 servicios", href: "/pago" },
};

export const Formes: Story = {
  args: { icon: <Viaje />, label: "Mi viaje", href: "/pago" },
  render: (args) => (
    <div className="flex items-end gap-3">
      <IconLink {...args} />
      <IconLink {...args} shape="square" />
      <Legende>circle (défaut) · square</Legende>
    </div>
  ),
};

export const Couleurs: Story = {
  args: { icon: <Viaje />, label: "Mi viaje", href: "/pago" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      {(["solid", "soft", "outline", "ghost"] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          {(["accent", "neutral", "danger"] as const).map((color) => (
            <IconLink key={color} {...args} variant={variant} color={color} />
          ))}
          <Legende>{variant}</Legende>
        </div>
      ))}
    </div>
  ),
};

// ⚠️ Côte à côte avec `IconButton` : à l'œil ils sont identiques (même table de couleurs, même
// rayon, même taille), à l'oreille et à l'usage ils ne le sont pas.
export const CompareAIconButton: Story = {
  args: { icon: <Viaje />, label: "Mi viaje", href: "/pago" },
  render: (args) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconLink {...args} variant="solid" color="accent" />
        <IconButton icon={<Viaje />} label="Mi viaje" variant="solid" color="accent" />
        <Legende>IconLink (annoncé « lien ») · IconButton (annoncé « bouton »)</Legende>
      </div>
      <Legende>
        Clic du milieu sur le premier : il s&apos;ouvre dans un nouvel onglet. Sur le second : rien.
      </Legende>
    </div>
  ),
};
