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

const Panier = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L20.5 8H6" />
    <circle cx="10" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
  </svg>
);

export const Defaut: Story = {
  args: { icon: <Panier />, label: "Carrito, 2 artículos", href: "/checkout" },
};

export const Formes: Story = {
  args: { icon: <Panier />, label: "Carrito", href: "/checkout" },
  render: (args) => (
    <div className="flex items-end gap-3">
      <IconLink {...args} />
      <IconLink {...args} shape="square" />
      <Legende>circle (défaut) · square</Legende>
    </div>
  ),
};

export const Couleurs: Story = {
  args: { icon: <Panier />, label: "Carrito", href: "/checkout" },
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
  args: { icon: <Panier />, label: "Carrito", href: "/checkout" },
  render: (args) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconLink {...args} variant="solid" color="accent" />
        <IconButton icon={<Panier />} label="Carrito" variant="solid" color="accent" />
        <Legende>IconLink (annoncé « lien ») · IconButton (annoncé « bouton »)</Legende>
      </div>
      <Legende>
        Clic du milieu sur le premier : il s&apos;ouvre dans un nouvel onglet. Sur le second : rien.
      </Legende>
    </div>
  ),
};
