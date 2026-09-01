import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CatalogBrowser, type CatalogProduct } from "./CatalogBrowser";

// Story d'un composant qui EXISTE DÉJÀ. C'est le test le plus exigeant du playground : ce
// composant réunit les trois dépendances qui cassent le plus souvent hors de Next —
// `useTranslations` (next-intl), le `Link` localisé de @/i18n/navigation, et `next/image`.
// S'il rend correctement ici, la chaîne est prouvée pour tous les composants à venir.
const produit = (over: Partial<CatalogProduct> & { id: string }): CatalogProduct => ({
  href: `/products/${over.id}`,
  testId: `catalog-link-${over.id}`,
  name: "Tour en lancha",
  descriptionSnippet: "Recorrido guiado de una hora por el embalse.",
  type: "activity",
  imageUrl: "/globe.svg",
  subtitle: null,
  ...over,
});

const meta = {
  title: "Existant/CatalogBrowser",
  component: CatalogBrowser,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CatalogBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  args: {
    products: [
      produit({ id: "tour-lancha" }),
      produit({ id: "kayak", name: "Kayak en el embalse", type: "activity" }),
      produit({
        id: "casa-kayam",
        name: "Casa Kayam",
        type: "lodging",
        subtitle: "6 alojamientos",
        descriptionSnippet: "Hospedaje frente al agua.",
      }),
    ],
  },
};

// État vide : c'est le seul chemin du composant qui a son propre testid en production
// (`catalog-no-results`), et celui qu'un catalogue filtré atteint le plus souvent.
export const AucunResultat: Story = { args: { products: [] } };

// Texte long : l'espagnol est 20 à 25 % plus long que l'anglais, et c'est ce qui fait déborder les
// titres de carte. À regarder en gabarit Mobile 390.
export const TexteLong: Story = {
  args: {
    products: [
      produit({
        id: "long",
        name: "Recorrido guiado en lancha por el Embalse de Guatapé con parada en la Piedra del Peñol",
        descriptionSnippet:
          "Un recorrido completo de dos horas por el embalse, con guía local, paradas fotográficas y bebida incluida.",
      }),
      produit({ id: "court", name: "Kayak" }),
    ],
  },
};

// Sans photo : le catalogue réel en contient beaucoup — la carte ne doit pas s'effondrer.
export const SansImage: Story = {
  args: { products: [produit({ id: "sans-image", imageUrl: null })] },
};
