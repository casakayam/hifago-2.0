import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Price } from "./Price";

// Les trois montants ci-dessous ne sont pas décoratifs : 80 000 est l'ordre de grandeur réel d'une
// activité à Guatapé, 0 est le montant qu'un catalogue renvoie quand `price_cop` est absent
// (`formatCop(product.price_cop ?? 0, locale)` dans products/[slug]/page.tsx), et 12 500 000 est
// celui qui déborde d'une carte étroite.
const meta = {
  title: "Atoms/Price",
  component: Price,
  parameters: { layout: "padded" },
  args: { locale: "es" },
} satisfies Meta<typeof Price>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = { args: { amountCop: 80000 } };

// Zéro s'affiche, il ne disparaît pas : « 0 COP » et « prix absent » ne se ressemblent pas à
// l'écran, et c'est bien 0 que la fiche produit passe quand `price_cop` est nul.
export const Zero: Story = { args: { amountCop: 0 } };

// Le montant le plus long que le catalogue puisse produire (un camp de plusieurs jours).
// À regarder en gabarit Mobile 390, dans la story `DansUnConteneurEtroit` ci-dessous.
export const GrandMontant: Story = { args: { amountCop: 12500000 } };

// ⚠️ La locale ne change pas que la langue : elle change la POSITION du symbole
// (« 80.000 COP » en es, « COP 80,000 » en en) et le séparateur de milliers. Un composant parent
// qui centre ou aligne à droite doit l'avoir vu.
export const DeuxLangues: Story = {
  args: { amountCop: 12500000 },
  render: (args) => (
    <dl className="flex flex-col gap-2">
      <div className="flex gap-2">
        <dt className="w-8 text-muted">es</dt>
        <dd>
          <Price amountCop={args.amountCop} locale="es" />
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-8 text-muted">en</dt>
        <dd>
          <Price amountCop={args.amountCop} locale="en" />
        </dd>
      </div>
    </dl>
  ),
};

// Conteneur étroit : le montant ne doit pas provoquer de défilement horizontal de la page. 9rem
// est plus étroit que la colonne d'une carte de catalogue en Mobile 390 — si ça tient ici, ça tient
// partout.
export const DansUnConteneurEtroit: Story = {
  args: { amountCop: 12500000 },
  render: (args) => (
    <div className="w-36 border border-border p-2">
      <Price {...args} />
    </div>
  ),
};
