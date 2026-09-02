import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BackLink } from "./BackLink";
import { PageShell } from "./PageShell";

// ⚠️ Ce que cette story vérifie vraiment, au-delà de l'apparence : que le `Link` localisé de
// "@/i18n/navigation" rend hors de Next. La chaîne est déjà prouvée par
// app/[locale]/CatalogBrowser.stories.tsx — s'y reporter si quelque chose résiste.
//
// Basculer la langue dans la barre d'outils ne change PAS le libellé : un atome ne traduit rien, il
// reçoit `label` déjà traduit. C'est visible ici, et c'est voulu.
const meta = {
  title: "Actions/BackLink",
  component: BackLink,
  parameters: { layout: "padded" },
} satisfies Meta<typeof BackLink>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le libellé réel de l'app (ProductPage.backToCatalog en espagnol).
export const Defaut: Story = {
  args: { href: "/", label: "Volver al catálogo" },
};

// Texte long : l'espagnol est 20 à 25 % plus long que l'anglais, et un lien de retour qui passe sur
// deux lignes ne doit pas perdre sa hauteur de cible ni son alignement. À regarder en Mobile 390.
export const TexteLong: Story = {
  args: {
    href: "/establishments/casa-kayam-guatape",
    label: "Volver a todos los alojamientos y actividades de Casa Kayam Guatapé",
  },
};

// ⚠️ Le contexte réel, et un constat à connaître : posé en enfant direct de PageShell (un conteneur
// `flex flex-col`), le lien devient un flex item et son `inline-flex` est « blockifié » — il
// s'étire donc sur toute la largeur, et la zone cliquable va jusqu'au bord droit de la page. Le
// motif d'origine (ProductDetailView.tsx:113) avait déjà exactement ce comportement, l'atome ne
// l'introduit pas. Un `self-start` le corrigerait ; il n'est pas dans le contrat, donc pas ajouté
// en silence — signalé au coordinateur.
export const DansUnePage: Story = {
  // `args` en plus du `render` : Storybook exige les props requises du composant même quand la
  // story rend elle-même. Ils pilotent le lien réellement affiché ci-dessous.
  args: { href: "/", label: "Volver al catálogo" },
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <PageShell variant="narrow">
      <BackLink {...args} />
      <div className="rounded border border-[var(--border)] p-4 text-sm">
        Contenu de la page — le lien de retour est toujours le premier enfant de la coquille.
      </div>
    </PageShell>
  ),
};
