import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GoogleButton, OAuthSection } from "./GoogleButton";

// ⚠️ À SAVOIR AVANT DE CLIQUER : le playground n'a pas de client Supabase. Un appui appelle
// `createClient()`, qui lève faute d'URL/clé publique — l'état d'échec ne s'affichera donc PAS ici,
// et ce n'est pas un défaut du composant. Cet état est tenu par `GoogleButton.test.tsx`, où le SDK
// est mocké ; ces stories servent le reste : la place du logo, la cible tactile, le séparateur, et
// le rendu du bloc dans les deux langues et les deux thèmes (barre d'outils Storybook).
const meta = {
  title: "Actions/GoogleButton",
  component: GoogleButton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof GoogleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {
  // La largeur des deux écrans qui le portent (`max-w-sm`) : hors de ce contenant, un bouton
  // `width="full"` s'étire à la fenêtre et ne montre pas ce qu'on regarde.
  decorators: [
    (Story) => (
      <div className="w-full max-w-sm">
        <Story />
      </div>
    ),
  ],
};

export const AvecUnNextATransporter: Story = {
  args: { next: "/carrito" },
  decorators: Defaut.decorators,
};

/** Le bloc réellement monté sur `/entrar` et `/registro` — bouton, séparateur, puis le formulaire. */
export const BlocAuDessusDuFormulaire: StoryObj = {
  render: () => (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <OAuthSection next="/carrito" />
      {/* Silhouette du formulaire email/mot de passe, pas les vrais champs : ce qu'on vient
          regarder ici, c'est l'équilibre entre le bouton et ce qui le suit. */}
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="h-12 rounded-[var(--radius)] border border-border" />
        <div className="h-12 rounded-[var(--radius)] border border-border" />
        <div className="h-12 rounded-[var(--radius)] bg-surface-secondary" />
      </div>
    </div>
  ),
};
