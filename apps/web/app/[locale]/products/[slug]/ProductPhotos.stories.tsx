import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProductPhotos } from "./ProductPhotos";

// Story d'un composant qui EXISTE DÉJÀ — elle n'en crée aucun. Sa raison d'être est de prouver que
// le playground sait rendre un composant de ce projet : ici `next/image` (avec `fill` + `sizes`) et
// le Carousel Embla de @hifago/ui. Sans elle, on validerait un tuyau vide.
//
// Images locales de public/ plutôt que des URL Supabase : le playground doit s'ouvrir sans Docker.
const slide = (id: string, url: string, alt: string) => ({ id, url, alt });

const meta = {
  title: "Existant/ProductPhotos",
  component: ProductPhotos,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ProductPhotos>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  args: {
    slides: [
      slide("1", "/globe.svg", "Vue du réservoir depuis la lancha"),
      slide("2", "/window.svg", "Départ du quai principal"),
      slide("3", "/file.svg", "Groupe à bord"),
    ],
  },
};

// Un seul média : le carousel masque ses flèches et ses points sous 2 slides.
export const UneSeulePhoto: Story = {
  args: { slides: [slide("1", "/globe.svg", "Vue du réservoir")] },
};

// État limite réel du catalogue : beaucoup de fiches n'ont aucune photo. Le composant rend `null`,
// et c'est ce qu'on veut voir ici plutôt que le découvrir en production.
export const SansPhoto: Story = {
  args: { slides: [] },
};
