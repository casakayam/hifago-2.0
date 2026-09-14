import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SelectorTipoCompacto } from "./SelectorTipoCompacto";
import { Legende } from "../playground/Legende";

// Le déclencheur compact, isolé. ⚠️ À voir OUVERT autant que fermé — même raison que
// `Coquille/LanguageSwitcher` : c'est ouvert qu'on constate si le panneau déborde à 390 px.
const TIPOS = [
  { tipo: "activity" as const, label: "Actividades", href: "/actividades" },
  { tipo: "lodging" as const, label: "Alojamientos", href: "/alojamientos" },
  { tipo: "transport" as const, label: "Transportes", href: "/transportes" },
  { tipo: "camp" as const, label: "Camps", href: "/camps" },
  { tipo: "evento" as const, label: "Eventos", href: "/eventos" },
];

const meta = {
  title: "Affichage/SelectorTipoCompacto",
  component: SelectorTipoCompacto,
  parameters: { layout: "padded" },
  args: { tipos: TIPOS, etiqueta: "Tipos de oferta", testId: "sel" },
} satisfies Meta<typeof SelectorTipoCompacto>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Le cas d'un listing : un type actif affiché sur le déclencheur. */
export const Cerrado: Story = {
  args: { tipoActivo: "lodging" },
};

/** Le cas de la home : aucun type actif, le déclencheur affiche l'étiquette générique. */
export const SinTipoActivo: Story = {
  args: { tipoActivo: undefined },
};

// ⚠️ Le panneau est TOUJOURS dans le HTML, même fermé — seulement masqué (voir l'en-tête du
// composant). Cette story invite à cliquer pour voir ce que contient le HTML servi, comme
// `Coquille/LanguageSwitcher → Ouvert`.
export const Abierto: Story = {
  args: { tipoActivo: "lodging" },
  render: (args) => (
    <div className="flex min-h-64 flex-col gap-3">
      <SelectorTipoCompacto {...args} />
      <Legende>
        Clique pour ouvrir. Les 5 liens existent dans le HTML même fermé : c&apos;est ce qui permet
        aux routes de catalogue d&apos;être découvertes par le maillage interne, y compris sur
        mobile.
      </Legende>
    </div>
  ),
};
