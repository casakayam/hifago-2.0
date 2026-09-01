import type { Meta, StoryObj } from "@storybook/nextjs-vite";

// Gabarit de référence de la structure d'une page publique — ce que la coquille devra produire.
//
// Il rend regardables des règles qui, écrites, restent abstraites : un seul <h1>, une hiérarchie de
// titres sans saut, et les landmarks (<header>, <nav>, <main>, <footer>). Aujourd'hui apps/web n'en
// a AUCUN : les huit pages ouvrent chacune leur propre <main>, sans en-tête ni pied de page.
//
// Le panneau « Accessibility » de la barre d'outils vérifie cette story comme les autres : c'est
// lui qui dira si l'ordre des titres est correct, pas la relecture.
const meta = {
  title: "Playground/Sémantique",
  // ⚠️ `id` explicite et SANS ACCENT : Storybook dérive sinon l'identifiant du titre en gardant les
  // accents (`playground-sémantique--…`), ce qui donne une URL fragile à encoder — constaté en
  // écrivant la vérification de cette story. Le titre affiché garde son accent, lui.
  id: "playground-semantique",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const StructureCible: Story = {
  render: () => (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] p-4">
        <nav aria-label="Principale" className="flex items-center justify-between gap-4">
          <span className="font-semibold">Hifago</span>
          <ul className="flex gap-4 text-sm">
            <li>Alojamientos</li>
            <li>Actividades</li>
          </ul>
        </nav>
      </header>

      <main className="flex-1 p-4">
        {/* Un seul <h1> par page, et c'est la coquille qui garantit qu'il est unique. */}
        <h1 className="text-2xl font-semibold">Titre de la page — un seul h1</h1>
        <p className="mt-2 max-w-[75ch] text-sm">
          La longueur de ligne est bornée pour rester lisible : au-delà d’environ 75 caractères,
          l’œil perd le début de la ligne suivante.
        </p>

        <section className="mt-6">
          <h2 className="text-xl font-medium">Section — h2</h2>
          <p className="mt-1 text-sm">Un h2 ne saute jamais un niveau depuis le h1.</p>

          <article className="mt-4">
            <h3 className="text-lg font-medium">Sous-section — h3</h3>
            <p className="mt-1 text-sm">
              Un composant de titre reçoit son niveau en prop&nbsp;: il ne décide jamais seul
              d’être un h1.
            </p>
          </article>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] p-4 text-sm">
        Pied de page — mentions légales, contact, politique d’annulation.
      </footer>
    </div>
  ),
};
