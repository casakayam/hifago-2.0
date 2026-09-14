import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BarraNavegacion } from "./BarraNavegacion";

// Le playground de la barre commune (fil d'Ariane + sélecteur de type) — 2026-09-14. Les 4 gabarits
// ci-dessous couvrent les 4 formes réelles que la barre prend sur la vitrine : home (un seul
// "Inicio", aucun onglet actif), listing (deux niveaux), page de catégorie (trois niveaux), fiche
// produit (trois niveaux, cas d'une chambre sous un établissement).
//
// ⚠️ DEUX PRÉSENTATIONS SELON LE GABARIT — à vérifier aux deux (Mobile 390 par défaut, Desktop
// 1280, barre d'outils Storybook), pas dans un seul : en dessous de `md`, la rangée d'onglets est
// remplacée par le déclencheur compact `SelectorTipoCompacto` (constaté en réel le 2026-09-14 :
// la rangée débordait et se coupait au bord de l'écran, et répétait le type actif trois fois avec
// le fil et le `<h1>`) ; à partir de `md`, la rangée d'onglets reste. Chaque story ci-dessous montre
// donc CHAQUE contexte deux fois selon le gabarit choisi dans la barre d'outils — pas deux stories
// séparées par gabarit.
const TIPOS = [
  { tipo: "activity" as const, label: "Actividades", href: "/actividades" },
  { tipo: "lodging" as const, label: "Alojamientos", href: "/alojamientos" },
  { tipo: "transport" as const, label: "Transportes", href: "/transportes" },
  { tipo: "camp" as const, label: "Camps", href: "/camps" },
  { tipo: "evento" as const, label: "Eventos", href: "/eventos" },
];

const meta = {
  title: "Affichage/BarraNavegacion",
  component: BarraNavegacion,
  parameters: { layout: "padded" },
  args: {
    locale: "es" as const,
    tipos: TIPOS,
    tiposEtiqueta: "Tipos de oferta",
    migasEtiqueta: "Ruta de navegación",
  },
} satisfies Meta<typeof BarraNavegacion>;

export default meta;
type Story = StoryObj<typeof meta>;

/** La home : un seul "Inicio" (page courante, sans lien), aucun onglet actif. */
export const SurAccueil: Story = {
  args: {
    migas: [{ nombre: "Inicio" }],
    tipoActivo: undefined,
  },
};

/** Une page de listing type (ex: /es/alojamientos) : deux niveaux, un onglet actif. */
export const SurListing: Story = {
  args: {
    migas: [{ nombre: "Inicio", href: "/" }, { nombre: "Alojamientos" }],
    tipoActivo: "lodging",
  },
};

/** Une page de catégorie (ex: /es/actividades/kayak) : trois niveaux, un onglet actif. */
export const SurCategoria: Story = {
  args: {
    migas: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Kayak" },
    ],
    tipoActivo: "activity",
  },
};

/** Une fiche produit (ex: une chambre) : trois niveaux — type puis établissement puis produit. */
export const SurFicha: Story = {
  args: {
    migas: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Alojamientos", href: "/alojamientos" },
      { nombre: "Posada del Lago", href: "/establecimientos/posada-del-lago" },
      { nombre: "Habitación doble" },
    ],
    tipoActivo: "lodging",
  },
};

/**
 * ⚠️ L'état limite à regarder aux DEUX gabarits : un nom de catégorie long (contenu partenaire,
 * personne ne garantit qu'il tient en un mot). En Mobile 390, c'est `Migas` qui gère déjà ce cas
 * (voir `Affichage/Migas → NombreLargo`) — ici on vérifie surtout que le déclencheur compact reste
 * lisible à côté. En Desktop 1280, c'est la rangée d'onglets qui ne doit pas être poussée hors
 * champ par un fil devenu large.
 */
export const NombreLargo: Story = {
  args: {
    migas: [
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Deportes náuticos y experiencias acuáticas en el embalse de Guatapé" },
    ],
    tipoActivo: "activity",
  },
};
