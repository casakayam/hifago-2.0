import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Title } from "./Title";

// Ce que ces stories servent à voir : que le NIVEAU et la TAILLE sont deux axes séparés. C'est la
// décision la moins évidente de l'atome, et la seule qu'on peut vérifier d'un coup d'œil — le
// panneau « Accessibility » vérifie l'ordre des titres pendant qu'on regarde leur taille.
const meta = {
  title: "Affichage/Title",
  component: Title,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Title>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le cas de loin le plus fréquent : le <h1> d'une page, `size` non renseigné, donc `lg`.
export const Defaut: Story = {
  args: { as: "h1", children: "Alojamientos y actividades en Guatapé" },
};

// Les trois niveaux avec leur taille par défaut, empilés dans l'ordre — h1 → h2 → h3, sans saut.
export const TousLesNiveaux: Story = {
  // `args` en plus du `render` : Storybook exige les props requises du composant même quand la
  // story rend elle-même (typage `Meta<typeof Title>`). Ils pilotent le premier titre, pour que les
  // contrôles de la barre latérale restent utiles au lieu d'être décoratifs.
  args: { as: "h1", children: "h1 — taille lg par défaut" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Title {...args} />
      <Title as="h2">h2 — taille md par défaut</Title>
      <Title as="h3">h3 — taille sm par défaut</Title>
    </div>
  ),
};

// ⚠️ La raison d'être de la prop `size`. Les trois <h2> « availabilityTitle » des formulaires de
// réservation sont en `text-sm` dans l'app réelle : sans `size`, on les écrirait <h3> pour obtenir
// cette taille, et la hiérarchie sauterait un niveau sous un <h1>. Ici le <h2> reste un <h2>.
export const PetitH2: Story = {
  args: { as: "h2", size: "sm", children: "Disponibilidad" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Title as="h1">Kayak en el embalse</Title>
      <Title {...args} />
    </div>
  ),
};

// Titre de 120 caractères : c'est la longueur réelle d'un nom de produit espagnol (« Recorrido
// guiado en lancha… », déjà en base). À regarder en Mobile 390 — c'est là que la césure se juge.
export const TexteLong: Story = {
  args: {
    as: "h1",
    children:
      "Recorrido guiado en lancha por el Embalse de Guatapé con parada fotográfica en la Piedra del Peñol",
  },
};
