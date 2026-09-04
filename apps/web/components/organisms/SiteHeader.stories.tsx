import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CartProvider } from "@/lib/cart/CartContext";
import { PanierPre } from "@/components/playground/PanierPre";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { SiteHeader } from "./SiteHeader";

// Le header de la vitrine — le premier `<header>`/`<nav>` du site.
//
// À regarder aux DEUX gabarits : c'est à 390 px que le logo, le panier, la pastille et le bouton
// de menu se disputent la largeur, et c'est là que le menu déplié peut recouvrir le contenu. Et
// dans les deux langues : l'espagnol fait 20 à 25 % de plus que l'anglais.
const meta = {
  title: "Coquille/SiteHeader",
  component: SiteHeader,
  parameters: {
    layout: "fullscreen",
  // ⚠️ Sans ce paramètre, la story ne rend RIEN : le `Link` de next-intl auquel on passe une prop
  // `locale` lit le chemin courant pour reconstruire l'URL de l'autre langue, et hors d'une route
  // Next ce chemin vaut `null` — « Cannot read properties of null (reading 'pathname') ».
  // `@storybook/nextjs-vite` fournit ce contexte par story ; c'est le seul moyen ici, car
  // `.storybook/preview.tsx` appartient à l'agent thème. Constaté le 2026-09-02 : ce lot est le
  // premier à exercer un lien localisé dans le playground depuis que la story CatalogBrowser, qui
  // le prouvait, a été supprimée.
  nextjs: { appDirectory: true, navigation: { pathname: "/products/kayak" } },
  },
} satisfies Meta<typeof SiteHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

function Cadre({ lignes = 0, isAuthenticated = false }: { lignes?: number; isAuthenticated?: boolean }) {
  return (
    <CartProvider>
      <PanierPre lignes={lignes} />
      <SiteHeader isAuthenticated={isAuthenticated} testId="header" />
    </CartProvider>
  );
}

export const Defaut: Story = {
  args: { isAuthenticated: false },
  render: () => <Cadre />,
};

export const PanierUnArticle: Story = {
  args: { isAuthenticated: false },
  render: () => <Cadre lignes={1} />,
};

export const PanierPlusieurs: Story = {
  args: { isAuthenticated: false },
  render: () => <Cadre lignes={4} />,
};

// ⚠️ Le cas qui déborde : à deux chiffres la pastille s'élargit et vient mordre le bord du bouton.
export const PanierDeuxChiffres: Story = {
  args: { isAuthenticated: false },
  render: () => <Cadre lignes={12} />,
};

// Au-delà de 99, l'affichage passe à « 99+ » : trois chiffres sortiraient du bouton, et le compte
// exact n'apprend plus rien à ce stade. Le nom accessible du lien, lui, garde le nombre réel.
//
// ⚠️ Deux headers dans UNE story pour comparer 12 et 100 : c'est ce que j'avais écrit d'abord, et
// axe l'a refusé — `landmark-no-duplicate-banner`, deux `<header>` sur la même page. C'est
// exactement le défaut que l'architecture du composant évite (un seul balisage qui se réorganise,
// jamais deux headers dont l'un serait masqué), attrapé ici sur la story elle-même. D'où deux
// stories séparées.
export const PanierAuDelaDeCent: Story = {
  args: { isAuthenticated: false },
  render: () => <Cadre lignes={100} />,
};

export const Connecte: Story = {
  args: { isAuthenticated: true },
  render: () => <Cadre lignes={2} isAuthenticated />,
};

// ⚠️ LA story du lot : le header collant AU-DESSUS d'un contenu qui défile. C'est la seule qui
// révèle sa hauteur réelle, son alignement avec le contenu, et surtout qu'il ne recouvre pas le
// premier élément de la page quand on remonte.
export const AuDessusDuContenu: Story = {
  args: { isAuthenticated: false },
  render: () => (
    <CartProvider>
      <PanierPre lignes={3} />
      <div className="flex min-h-screen flex-col">
        <SiteHeader isAuthenticated={false} testId="header" />
        <PageShell variant="large">
          <Title as="h1">Alojamientos y actividades en Guatapé</Title>
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} className="text-sm">
              Párrafo {i + 1} — desplázate para comprobar que la barra se queda arriba, que sigue
              siendo legible sobre el contenido y que no tapa el título al volver arriba.
            </p>
          ))}
        </PageShell>
      </div>
    </CartProvider>
  ),
};
