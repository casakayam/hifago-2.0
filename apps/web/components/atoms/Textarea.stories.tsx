import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Textarea, type TextareaProps } from "./Textarea";

// Le champ multi-lignes. ⚠️ Aucun écran ne l'utilise aujourd'hui — c'est une pièce du design
// system demandée par Jérôme, pas une extraction. Ces stories servent donc à décider à quoi il
// ressemblera le jour où un formulaire en aura besoin, pas à documenter un existant.
//
// Le formulaire complet qui le montre à côté d'un `Field`, d'un `Select` et d'un `Checkbox` est la
// story « Atoms/Field → Formulaire ».//
// ⚠️ Les valeurs de chaque story vivent dans `args`, jamais dans le `render` après le spread :
// `<X {...args} error="…" />` écrase silencieusement le contrôle du panneau, et donne à croire que
// la prop ne fonctionne pas (constaté le 2026-09-02 sur le `type` de Field). Seule `valeurInitiale`
// reste dans le render — elle appartient au wrapper d'état, pas au composant.
const meta = {
  title: "Atoms/Textarea",
  component: Textarea,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

function ZoneControlee({ valeurInitiale = "", ...props }: Omit<TextareaProps, "value" | "onChange"> & { valeurInitiale?: string }) {
  const [valeur, setValeur] = useState(valeurInitiale);
  return <Textarea {...props} value={valeur} onChange={setValeur} />;
}

function Legende({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted">{children}</span>;
}

export const Defaut: Story = {
  args: { label: "Petición especial", placeholder: "Alergias, hora de llegada…", value: "", onChange: () => {} },
  render: (args) => <ZoneControlee {...args} />,
};

export const Rempli: Story = {
  args: { label: "Petición especial", value: "", onChange: () => {} },
  render: (args) => (
    <ZoneControlee
      {...args}
      valeurInitiale="Llegamos sobre las 22:00, después del check-in habitual. ¿Es posible dejar la llave en recepción?"
    />
  ),
};

export const EnErreur: Story = {
  args: {
    label: "Petición especial",
    error: "Escribe al menos una frase completa",
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <ZoneControlee {...args} valeurInitiale="ok" />
  ),
};

export const Requis: Story = {
  args: { label: "Motivo de la cancelación", isRequired: true, value: "", onChange: () => {} },
  render: (args) => <ZoneControlee {...args} />,
};

export const AvecAide: Story = {
  args: {
    label: "Petición especial",
    hint: "Máximo 500 caracteres",
    maxLength: 500,
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ZoneControlee {...args} />
      <Legende>⚠️ En erreur, HeroUI masque l&apos;aide au profit du message — voir Atoms/Field.</Legende>
    </div>
  ),
};

export const Desactive: Story = {
  args: { label: "Petición especial", isDisabled: true, value: "", onChange: () => {} },
  render: (args) => <ZoneControlee {...args} valeurInitiale="No editable" />,
};

// Le seul réglage propre au multi-lignes : combien de lignes avant de faire défiler.
export const Lignes: Story = {
  args: { label: "A", value: "", onChange: () => {} },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <ZoneControlee label="Dos líneas" rows={2} />
        <Legende>rows=2</Legende>
      </div>
      <div className="flex flex-col gap-1">
        <ZoneControlee label="Tres líneas (défaut)" />
        <Legende>rows=3 — de quoi écrire deux phrases sans faire défiler</Legende>
      </div>
      <div className="flex flex-col gap-1">
        <ZoneControlee label="Seis líneas" rows={6} />
        <Legende>rows=6</Legende>
      </div>
    </div>
  ),
};

export const TexteLong: Story = {
  args: { label: "A", value: "", onChange: () => {} },
  render: () => (
    <ZoneControlee
      label="Cuéntanos cualquier detalle que debamos conocer antes de tu llegada al alojamiento"
      hint="Por ejemplo alergias alimentarias, movilidad reducida, o una hora de llegada fuera del horario habitual"
      valeurInitiale="Somos cuatro personas, dos de ellas con movilidad reducida. Llegaremos en coche sobre las 23:00 y necesitaríamos aparcar cerca de la entrada principal si es posible."
    />
  ),
};
