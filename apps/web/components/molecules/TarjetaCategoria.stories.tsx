import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TarjetaCategoria } from "./TarjetaCategoria";

// Une tuile de l'index des catégories (spec 29 §5a). Ce qui se juge ici et nulle part ailleurs :
// la tuile garde-t-elle la même HAUTEUR selon qu'elle porte un texte, deux lignes de texte, ou
// rien ? C'est ce qui fait ou casse la grille, et aucun test ne le voit.
//
// ⚠️ `SinImagen` n'est pas un cas limite exotique : c'est l'état RÉEL en local et en e2e, le seed
// n'ayant aucune image de catégorie (§6e). C'est donc la story la plus fidèle à ce qu'on verra.
const meta = {
  title: "Affichage/TarjetaCategoria",
  component: TarjetaCategoria,
  parameters: {
    layout: "centered",
    // Le titre passe par le `Link` de next-intl, qui lit le contexte de route — `null` hors d'une
    // route Next, et rien ne s'afficherait.
    nextjs: { appDirectory: true, navigation: { pathname: "/actividades" } },
  },
  args: {
    libellesSinTag: {
      nombre: "Otras actividades",
      descripcion: "Todo lo que todavía no entra en una categoría.",
    },
  },
} satisfies Meta<typeof TarjetaCategoria>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
  slug: "kayak",
  href: "/actividades/kayak",
  nombre: "Kayak",
  descripcion: "Recorridos guiados por el embalse, con equipo incluido.",
  foto: { url: "/globe.svg" },
  esSinTag: false,
  localesNativas: ["es", "en"],
  testId: "categoria-kayak",
};

export const Completa: Story = { args: { categoria: base, prioridad: true } };

// ⚠️ L'état réel du seed : aplat gris à la place de l'image. La tuile doit garder EXACTEMENT la
// même forme — c'est le contrat du substitut de l'atome `Image`, au même ratio.
export const SinImagen: Story = { args: { categoria: { ...base, foto: null } } };

// Une catégorie créée en admin mais pas encore rédigée : le titre se suffit, et surtout aucun bloc
// vide ne doit s'ouvrir sous lui.
export const SinTexto: Story = {
  args: { categoria: { ...base, descripcion: null } },
};

// La tuile « Otras actividades » : ni nom ni texte en base, tout vient des messages.
export const OtrasActividades: Story = {
  args: {
    categoria: {
      slug: "otras",
      href: "/actividades/otras",
      nombre: "",
      descripcion: null,
      foto: null,
      esSinTag: true,
      localesNativas: ["es", "en"],
      testId: "categoria-otras",
    },
  },
};

// ⚠️ L'état limite à regarder aux deux gabarits : le texte vient d'un admin, personne ne garantit
// qu'il tient en deux lignes. Il ne doit ni faire déborder la tuile ni désaligner la grille.
export const TextoLargo: Story = {
  args: {
    categoria: {
      ...base,
      nombre: "Deportes náuticos y experiencias acuáticas",
      descripcion:
        "Recorridos guiados en kayak, paddle y lancha por todo el embalse de Guatapé, con equipo incluido, salidas cada mañana desde el muelle principal y acompañamiento de guías locales certificados.",
    },
  },
};
