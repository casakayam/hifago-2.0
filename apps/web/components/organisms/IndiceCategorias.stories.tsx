import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { CategoriaConOferta } from "@/lib/catalog/tipos";
import { IndiceCategorias } from "./IndiceCategorias";

// L'index des catégories de `/es/actividades` (spec 29 §5a). Ce qui se juge ICI :
//  • le passage de 1 à 2 puis 3 colonnes, aux trois gabarits de la barre d'outils ;
//  • la dernière rangée incomplète — quatre tuiles sur trois colonnes laissent un trou ;
//  • et surtout l'ALIGNEMENT quand les tuiles n'ont pas toutes un texte, ce qui sera le cas d'un
//    catalogue en cours de rédaction.
//
// Le contexte i18n vient du décorateur global de `.storybook/preview.tsx`.
const meta = {
  title: "Affichage/IndiceCategorias",
  component: IndiceCategorias,
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true, navigation: { pathname: "/actividades" } },
  },
  args: {
    libellesSinTag: {
      nombre: "Otras actividades",
      descripcion: "Todo lo que todavía no entra en una categoría.",
    },
  },
} satisfies Meta<typeof IndiceCategorias>;

export default meta;
type Story = StoryObj<typeof meta>;

function cat(
  slug: string,
  nombre: string,
  descripcion: string | null,
  conFoto = true
): CategoriaConOferta {
  return {
    slug,
    href: `/actividades/${slug}`,
    nombre,
    descripcion,
    foto: conFoto ? { url: "/globe.svg" } : null,
    esSinTag: false,
    localesNativas: ["es", "en"],
    testId: `categoria-${slug}`,
  };
}

const SIN_TAG: CategoriaConOferta = {
  slug: "otras",
  href: "/actividades/otras",
  nombre: "",
  descripcion: null,
  foto: null,
  esSinTag: true,
  localesNativas: ["es", "en"],
  testId: "categoria-otras",
};

// Le catalogue tel qu'on l'espère : des catégories rédigées et illustrées, plus la tuile de fin.
export const Redactadas: Story = {
  args: {
    categorias: [
      cat("buceo", "Buceo", "Inmersiones guiadas en el embalse."),
      cat("kayak", "Kayak", "Recorridos guiados, con equipo incluido."),
      cat("parapente", "Parapente", "Vuelos biplaza sobre el Peñón."),
      cat("senderismo", "Senderismo", "Caminatas por el bosque nativo."),
      SIN_TAG,
    ],
  },
};

// ⚠️ L'état RÉEL en local et en e2e : aucune image, aucun texte encore rédigé (§6e, et la Tranche 3
// n'a pas encore donné à l'admin de quoi les remplir). La grille doit rester lisible ainsi.
export const SinRedactar: Story = {
  args: {
    categorias: [
      cat("buceo", "Buceo", null, false),
      cat("kayak", "Kayak", null, false),
      cat("parapente", "Parapente", null, false),
      SIN_TAG,
    ],
  },
};

// ⚠️ Le cas qui désaligne : certaines tuiles rédigées, d'autres non. C'est l'état d'un catalogue en
// cours de remplissage, donc le plus probable des trois — et le seul où l'on voit si les tuiles
// s'étirent à la hauteur de la plus haute ou flottent chacune à la sienne.
export const RedaccionParcial: Story = {
  args: {
    categorias: [
      cat("buceo", "Buceo", "Inmersiones guiadas en el embalse, con instructor certificado."),
      cat("kayak", "Kayak", null),
      cat("parapente", "Parapente", "Vuelos biplaza."),
      SIN_TAG,
    ],
  },
};

// Le tout premier état du site : une seule catégorie, et tout le reste non classé.
export const CasiVacio: Story = {
  args: { categorias: [cat("kayak", "Kayak", null, false), SIN_TAG] },
};
