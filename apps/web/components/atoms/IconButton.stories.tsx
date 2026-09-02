import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconButton } from "./IconButton";
import type { ButtonColor, ButtonVariant } from "./Button";
import { Legende } from "../playground/Legende";

// Le bouton sans libellé visible. Story séparée de « Atoms/Button » parce que le composant l'est :
// ici le libellé est REQUIS (il devient le nom accessible) et la forme compte, deux choses qui
// n'ont pas de sens sur un bouton texte.
//
// ⚠️ À vérifier avec le panneau « Accessibility » : aucune de ces stories ne doit remonter de
// « Buttons must have discernible text ». C'est le seul défaut que ce composant existe pour rendre
// impossible.
const meta = {
  title: "Actions/IconButton",
  component: IconButton,
  parameters: { layout: "padded" },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Icônes inline : aucune dépendance d'icônes ici (lucide-react est déclaré par packages/ui, pas
// par apps/web — l'importer serait une dépendance fantôme).
const Croix = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const Coeur = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 20s-7-4.5-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.5-7 9-7 9z" />
  </svg>
);

const VARIANTS: ButtonVariant[] = ["solid", "soft", "outline", "ghost"];
const COLORS: ButtonColor[] = ["accent", "neutral", "danger"];

export const Defaut: Story = {
  args: { icon: <Croix />, label: "Quitar del carrito" },
};

// ⚠️ Depuis que le rayon du bouton est descendu à `var(--radius)` — 8 px avec les jetons actuels,
// demande de Jérôme du 2026-09-02 —, `circle` est la SEULE façon d'obtenir un bouton rond. Avant,
// il l'était par accident : le `rounded-3xl` de HeroUI (24 px) dépassait la moitié de la hauteur
// (22 px en `lg`) et le navigateur rabotait à 50 %, si bien que `circle` et `square` rendaient
// pareil. La différence entre les deux lignes ci-dessous est donc nouvelle, et voulue.
export const Formes: Story = {
  // ⚠️ `variant="soft"` ici, alors que le défaut du composant est `ghost` : sans fond, la forme
  // est littéralement invisible — constaté en relisant la capture de cette story, où les deux
  // lignes étaient identiques. Une story qui montre une forme doit lui donner de quoi se voir.
  args: { icon: <Croix />, label: "Cerrar", variant: "soft" },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-3">
        <IconButton {...args} size="sm" />
        <IconButton {...args} size="md" />
        <IconButton {...args} size="lg" />
        <Legende>circle (défaut) — sm / md / lg</Legende>
      </div>
      <div className="flex items-end gap-3">
        <IconButton {...args} shape="square" size="sm" />
        <IconButton {...args} shape="square" size="md" />
        <IconButton {...args} shape="square" size="lg" />
        <Legende>square</Legende>
      </div>
      {/* L'affordance, qui est le vrai sujet d'un bouton d'icône : le défaut `ghost` n'annonce
          rien tant qu'on ne le survole pas. C'est le bon choix pour une croix de fermeture posée
          sur un contenu, mais pas pour une action isolée — d'où les trois côte à côte. */}
      <div className="flex items-end gap-3">
        <IconButton {...args} variant="ghost" />
        <IconButton {...args} variant="soft" />
        <IconButton {...args} variant="outline" />
        <IconButton {...args} variant="solid" color="accent" />
        <Legende>ghost (défaut) · soft · outline · solid — l&apos;affordance au repos</Legende>
      </div>
    </div>
  ),
};

// Les deux axes de Button s'appliquent tels quels : même table de couleurs, aucune divergence
// possible entre les deux composants.
export const Couleurs: Story = {
  args: { icon: <Coeur />, label: "Guardar en favoritos" },
  render: (args) => (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Legende>{variant}</Legende>
          <div className="flex items-center gap-3">
            {COLORS.map((color) => (
              <IconButton key={color} {...args} variant={variant} color={color} />
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Etats: Story = {
  args: { icon: <Croix />, label: "Quitar" },
  render: (args) => (
    <div className="flex items-end gap-3">
      <div className="flex flex-col items-start gap-1">
        <IconButton {...args} />
        <Legende>défaut</Legende>
      </div>
      <div className="flex flex-col items-start gap-1">
        <IconButton {...args} isDisabled />
        <Legende>désactivé</Legende>
      </div>
      <div className="flex flex-col items-start gap-1">
        {/* En cours, le nom accessible bascule sur `pendingLabel` : un bouton d'icône n'a pas de
            texte visible à remplacer, c'est son seul moyen d'annoncer ce qui se passe. */}
        <IconButton {...args} isPending pendingLabel="Quitando…" />
        <Legende>en cours</Legende>
      </div>
    </div>
  ),
};
