import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TypeBadge } from "./TypeBadge";

// Les libellés ci-dessous sont ceux de production (messages/es/HomePage.json → `types.*`), copiés
// tels quels : un atome ne traduit rien, c'est son appelant qui lui passe la chaîne résolue. Les
// recopier ici plutôt que d'appeler `useTranslations` est donc conforme, pas un raccourci.
const LIBELLES_ES: Record<string, string> = {
  lodging: "Alojamiento",
  activity: "Actividad",
  transport: "Transporte",
  camp: "Camp",
  evento: "Evento",
};

const meta = {
  title: "Atoms/TypeBadge",
  component: TypeBadge,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TypeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = { args: { type: "lodging", label: LIBELLES_ES.lodging } };

// Les cinq types réels côte à côte : c'est la seule vue qui dit si les teintes se distinguent
// vraiment les unes des autres. ⚠️ Bascule le thème (barre d'outils) : le thème `vitrine` ne
// définit AUCUN jeton et tourne sur les défauts HeroUI, le thème `admin` en redéfinit ~37 — les
// deux rendus n'ont donc rien à voir.
export const TousLesTypes: Story = {
  args: { type: "lodging", label: LIBELLES_ES.lodging },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(LIBELLES_ES).map(([type, label]) => (
        <TypeBadge key={type} type={type} label={label} />
      ))}
    </div>
  ),
};

// Le repli. Un type ajouté en base (ou un `products.type` élargi par une migration) ne doit jamais
// faire planter une page publique ni rendre un badge vide : il retombe sur le style neutre et
// affiche quand même son libellé.
export const TypeInconnu: Story = {
  args: { type: "coworking", label: "Coworking" },
};

// Libellé long en espagnol — l'espagnol fait 20 à 25 % de plus que l'anglais, c'est lui qui fait
// déborder. Placé dans un conteneur étroit pour que le débordement se voie au lieu de se diluer
// dans la largeur du canevas. À regarder en gabarit Mobile 390.
export const TexteLong: Story = {
  args: { type: "lodging", label: "Alojamiento compartido con desayuno incluido" },
  render: (args) => (
    <div className="w-48 border border-border p-2">
      <TypeBadge {...args} />
    </div>
  ),
};
