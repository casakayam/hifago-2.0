import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { EstadoVacio } from "./EstadoVacio";

// Les libellés ci-dessous sont en espagnol et ne sont pas décoratifs : l'accueil est servi en
// `x-default` espagnol, et c'est cette langue qui produit les phrases les plus longues des deux
// locales routées. Ce que ces stories servent à juger tient en deux points — la sobriété du bloc
// (aucun bouton : le bloc de recherche reste juste au-dessus et c'est lui l'action) et le
// comportement du texte centré quand il s'allonge.
const meta = {
  title: "Affichage/EstadoVacio",
  component: EstadoVacio,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EstadoVacio>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le cas réel de la spec 28 : des critères dans l'URL, aucun résultat dans aucune des cinq
// sections. La description dit quoi faire ensuite — elle nomme les trois critères qui bloquent le
// plus souvent (dates, personas, tag).
export const Defaut: Story = {
  args: {
    titulo: "No encontramos ofertas para tu búsqueda",
    descripcion: "Prueba con otras fechas, con menos personas o quita algún filtro.",
  },
};

// La description est optionnelle, et son absence ne doit pas laisser de blanc : le `gap-2` ne
// s'ouvre pas sur un paragraphe vide, le bloc reste centré et compact. C'est la forme qu'auront les
// pages de listing de la spec 29, où le titre se suffit à lui-même.
export const SinDescripcion: Story = {
  args: { titulo: "Todavía no hay actividades en esta categoría" },
};

// ⚠️ L'état limite à regarder aux DEUX gabarits. En Mobile 390 : la césure et le nombre de lignes.
// En 1280 : c'est ici que se voit `max-w-prose` — sans lui, un texte centré sur toute la largeur
// de la fenêtre force l'œil à parcourir la page entière pour revenir au début de la ligne
// suivante. Les longueurs employées sont réalistes : un titre qui reprend les critères saisis et
// une consigne complète en espagnol.
export const TextoLargo: Story = {
  args: {
    titulo:
      "No encontramos ninguna oferta disponible para 8 personas entre el 24 y el 27 de diciembre en Guatapé",
    descripcion:
      "Puedes ampliar las fechas, reducir el número de personas o quitar el filtro de categoría para ver todo lo que hay disponible en el embalse y sus alrededores durante esa semana.",
  },
};
