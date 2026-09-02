import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Select, type SelectOption, type SelectProps } from "./Select";
import { Legende } from "../playground/Legende";

// La liste déroulante. ⚠️ C'est le composant le plus rentable du lot : le filtre par type du
// catalogue occupe aujourd'hui quinze lignes de JSX compound (CatalogBrowser.tsx:58-80).
//
// À ouvrir vraiment — le popover, la sélection au clavier et l'indicateur de l'option choisie ne se
// jugent pas sur une capture.//
// ⚠️ Les valeurs de chaque story vivent dans `args`, jamais dans le `render` après le spread :
// `<X {...args} error="…" />` écrase silencieusement le contrôle du panneau, et donne à croire que
// la prop ne fonctionne pas (constaté le 2026-09-02 sur le `type` de Field). Seule `valeurInitiale`
// reste dans le render — elle appartient au wrapper d'état, pas au composant.
const meta = {
  title: "Saisie/Select",
  component: Select,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

// Les cinq types réels de `products.type`, avec leurs libellés espagnols — ceux du catalogue.
const TYPES: SelectOption[] = [
  { value: "lodging", label: "Alojamiento" },
  { value: "activity", label: "Actividad" },
  { value: "transport", label: "Transporte" },
  { value: "camp", label: "Camp" },
  { value: "evento", label: "Evento" },
];

function ListeControlee({ valeurInitiale = "", ...props }: Omit<SelectProps, "value" | "onChange"> & { valeurInitiale?: string }) {
  const [valeur, setValeur] = useState(valeurInitiale);
  return <Select {...props} value={valeur} onChange={setValeur} />;
}

// Le cas du catalogue : rien de sélectionné, donc « tous ».
export const Defaut: Story = {
  args: { label: "Tipo", options: TYPES, allLabel: "Todos los tipos", value: "", onChange: () => {} },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ListeControlee {...args} />
      <Legende>
        ⚠️ L&apos;entrée « tous » est une prop, pas une affaire d&apos;appelant : le catalogue la
        fabriquait à la main, et le prochain écran l&apos;aurait nommée autrement.
      </Legende>
    </div>
  ),
};

export const Rempli: Story = {
  args: { label: "Tipo", options: TYPES, allLabel: "Todos los tipos", value: "", onChange: () => {} },
  render: (args) => <ListeControlee {...args} valeurInitiale="activity" />,
};

// Sans `allLabel`, le choix est obligatoire parmi les options — le cas d'un formulaire, par
// opposition à un filtre.
export const SansEntreeToutes: Story = {
  args: { label: "País de residencia", options: TYPES, value: "", onChange: () => {} },
  render: () => (
    <ListeControlee
      label="País de residencia"
      options={[
        { value: "co", label: "Colombia" },
        { value: "fr", label: "Francia" },
        { value: "es", label: "España" },
      ]}
      valeurInitiale="co"
      isRequired
    />
  ),
};

export const EnErreur: Story = {
  args: {
    label: "Tipo",
    options: TYPES,
    isRequired: true,
    error: "Elige un tipo para continuar",
    value: "",
    onChange: () => {},
  },
  render: (args) => <ListeControlee {...args} />,
};

export const AvecAide: Story = {
  args: {
    label: "Tipo",
    options: TYPES,
    allLabel: "Todos los tipos",
    hint: "Filtra el catálogo por categoría",
    value: "",
    onChange: () => {},
  },
  render: (args) => <ListeControlee {...args} />,
};

export const Desactive: Story = {
  args: { label: "Tipo", options: TYPES, isDisabled: true, value: "", onChange: () => {} },
  render: (args) => <ListeControlee {...args} valeurInitiale="lodging" />,
};

// Le cas réel du catalogue : la liste à côté d'une recherche qui prend la place restante.
export const DansUneBarreDeFiltres: Story = {
  args: {
    label: "Tipo",
    options: TYPES,
    allLabel: "Todos los tipos",
    width: "short",
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-wrap items-end gap-4">
      <ListeControlee {...args} />
      <Legende>
        width=&quot;short&quot; — la liste ne s&apos;étire pas, c&apos;est la recherche à côté
        d&apos;elle qui prend la place (voir Saisie/Field → Largeurs).
      </Legende>
    </div>
  ),
};

export const TexteLong: Story = {
  args: { label: "A", options: TYPES, value: "", onChange: () => {} },
  render: () => (
    <ListeControlee
      label="Tipo de alojamiento o actividad que estás buscando"
      allLabel="Todos los tipos disponibles en el catálogo de Guatapé"
      options={[
        { value: "lodging", label: "Alojamiento completo con cocina y terraza privada" },
        { value: "activity", label: "Actividad guiada por el embalse con parada fotográfica" },
      ]}
      hint="El filtro se aplica inmediatamente sobre los resultados mostrados debajo"
    />
  ),
};
