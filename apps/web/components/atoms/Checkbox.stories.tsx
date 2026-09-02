import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Checkbox, type CheckboxProps } from "./Checkbox";
import { Legende } from "../playground/Legende";

// La case à cocher. Son seul usage réel aujourd'hui est le consentement marketing du paiement
// (CheckoutForm.tsx:388-396, huit lignes de JSX compound).
//
// ⚠️ C'est le seul composant du lot dont l'aide et l'erreur sont reliées À LA MAIN : contrairement
// aux trois autres, il n'a pas de conteneur react-aria qui pose `aria-describedby` pour lui.//
// ⚠️ Les valeurs de chaque story vivent dans `args`, jamais dans le `render` après le spread :
// `<X {...args} error="…" />` écrase silencieusement le contrôle du panneau, et donne à croire que
// la prop ne fonctionne pas (constaté le 2026-09-02 sur le `type` de Field). Seule ``initial``
// reste dans le render — elle appartient au wrapper d'état, pas au composant.
const meta = {
  title: "Saisie/Checkbox",
  component: Checkbox,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

function CaseControlee({ initial = false, ...props }: Omit<CheckboxProps, "isSelected" | "onChange"> & { initial?: boolean }) {
  const [coche, setCoche] = useState(initial);
  return <Checkbox {...props} isSelected={coche} onChange={setCoche} />;
}

export const Defaut: Story = {
  args: { label: "Quiero recibir ofertas de Hifago", isSelected: false, onChange: () => {} },
  render: (args) => <CaseControlee {...args} />,
};

export const Cochee: Story = {
  args: { label: "Quiero recibir ofertas de Hifago", isSelected: false, onChange: () => {} },
  render: (args) => <CaseControlee {...args} initial />,
};

export const EnErreur: Story = {
  args: {
    label: "Acepto las condiciones de reserva",
    error: "Debes aceptar las condiciones para continuar",
    isSelected: false,
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <CaseControlee {...args} />
      <Legende>
        ⚠️ Le message n&apos;est pas écrit en `text-danger` : ce jeton est un aplat, mesuré à 3.56:1
        sur fond clair — sous le seuil WCAG. C&apos;est --danger-soft-foreground qui est la couleur
        de texte de la famille.
      </Legende>
    </div>
  ),
};

export const AvecAide: Story = {
  args: {
    label: "Quiero recibir ofertas de Hifago",
    hint: "Puedes darte de baja en cualquier momento",
    isSelected: false,
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <CaseControlee {...args} />
      <CaseControlee
        label="Acepto las condiciones de reserva"
        hint="Cancelación gratuita hasta 48 horas antes"
        error="Debes aceptar para continuar"
      />
      <Legende>
        ⚠️ Ici l&apos;aide RESTE visible sous l&apos;erreur, contrairement aux trois autres champs :
        HeroUI ne masque la description que dans ses conteneurs de champ, et la case n&apos;en a pas.
      </Legende>
    </div>
  ),
};

export const Desactive: Story = {
  args: {
    label: "Quiero recibir ofertas de Hifago",
    isDisabled: true,
    isSelected: false,
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <CaseControlee {...args} />
      <CaseControlee label="Ya estás suscrito" initial isDisabled />
    </div>
  ),
};

export const TexteLong: Story = {
  args: { label: "A", isSelected: false, onChange: () => {} },
  render: () => (
    <CaseControlee
      label="Acepto las condiciones de reserva, la política de cancelación y el tratamiento de mis datos personales para gestionar la estancia"
      hint="Puedes consultar el detalle completo en la página de condiciones antes de confirmar"
    />
  ),
};
