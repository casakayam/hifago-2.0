import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteMenu } from "./SiteMenu";
import { Legende } from "../playground/Legende";

// Le panneau de navigation du header, isolé de sa barre.
//
// ⚠️ La story la plus utile est `Replie` regardée à 1280 : c'est là qu'on voit que le MÊME balisage
// devient une rangée de boutons ronds. À 390 px, `Deplie` montre la liste avec ses libellés écrits.
const meta = {
  title: "Coquille/SiteMenu",
  component: SiteMenu,
  parameters: {
    layout: "padded",
    // Sans ce paramètre, la story ne rend rien : le `Link` de next-intl auquel on passe une prop
    // `locale` lit le chemin courant, `null` hors d'une route Next. Voir Organisms/SiteHeader.
    nextjs: { appDirectory: true, navigation: { pathname: "/products/kayak" } },
  },
} satisfies Meta<typeof SiteMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

// Replié : invisible sous `md`, en ligne au-dessus. À regarder aux deux gabarits — c'est le même
// DOM dans les deux cas.
export const Replie: Story = {
  args: { isAuthenticated: false, isOpen: false, id: "menu", testId: "menu" },
  render: (args) => (
    <div className="relative flex flex-col gap-3">
      <SiteMenu {...args} />
      <Legende>
        À 390 px : rien à l&apos;écran, mais les liens sont dans le HTML — c&apos;est ce que voit
        Googlebot. À 1280 px : la rangée de boutons ronds de la barre.
      </Legende>
    </div>
  ),
};

// Déplié : la liste avec ses libellés écrits, puis la langue en bas, séparée par un filet.
export const Deplie: Story = {
  args: { isAuthenticated: false, isOpen: true, id: "menu", testId: "menu" },
  render: (args) => (
    <div className="relative flex min-h-72 flex-col">
      <SiteMenu {...args} />
    </div>
  ),
};

export const DeplieConnecte: Story = {
  args: { isAuthenticated: true, isOpen: true, id: "menu", testId: "menu" },
  render: (args) => (
    <div className="relative flex min-h-72 flex-col">
      <SiteMenu {...args} />
    </div>
  ),
};
