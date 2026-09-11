import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PhoneField, type PhoneFieldProps } from "./PhoneField";
import { Legende } from "../playground/Legende";

// Le champ téléphone international (2026-09-10) : indicatif pays + numéro, validation E.164 réelle
// via react-phone-number-input — ce que `Field type="tel"` ne pouvait pas faire.
const meta = {
  title: "Saisie/PhoneField",
  component: PhoneField,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PhoneField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Même rôle que `ChampControle` de Field.stories.tsx : `value`/`onChange` sont les deux seules
 * props qu'une story ne peut pas laisser piloter par le panneau de contrôles. */
function ChampControle({
  valeurInitiale = "",
  ...props
}: PhoneFieldProps & { valeurInitiale?: string }) {
  const [valeur, setValeur] = useState(valeurInitiale);
  return <PhoneField {...props} value={valeur} onChange={setValeur} />;
}

const BASE_ARGS = {
  label: "WhatsApp",
  countryLabel: "Indicativo del país",
  value: "",
  onChange: () => {},
};

export const Defaut: Story = {
  args: BASE_ARGS,
  render: (args) => <ChampControle {...args} />,
};

export const Rempli: Story = {
  args: BASE_ARGS,
  render: (args) => <ChampControle {...args} valeurInitiale="+573001234567" />,
};

// ⚠️ Le seul état que ce composant ajoute par rapport à `Field type="tel"` : un numéro qui a une
// forme plausible mais n'est pas un numéro réel pour le pays sélectionné (libphonenumber-js).
export const EnErreur: Story = {
  args: { ...BASE_ARGS, error: "El número de WhatsApp no es válido" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} valeurInitiale="+57123" />
      <Legende>
        Erreur reliée à la main (aria-describedby, aria-invalid) : ce champ n&apos;a pas de
        conteneur react-aria comme Field/Select, la lib pilote elle-même le DOM des deux
        sous-champs.
      </Legende>
    </div>
  ),
};

export const Requis: Story = {
  args: { ...BASE_ARGS, isRequired: true },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} />
      <Legende>
        ⚠️ aria-required seulement, jamais l&apos;attribut natif required (même piège que Field) :
        CheckoutForm.tsx valide désormais requis + format en JS avant l&apos;appel RPC.
      </Legende>
    </div>
  ),
};

export const AvecAide: Story = {
  args: { ...BASE_ARGS, hint: "Te escribiremos ahí para confirmar tu reserva" },
  render: (args) => <ChampControle {...args} />,
};

export const Desactive: Story = {
  args: { ...BASE_ARGS, isDisabled: true },
  render: (args) => <ChampControle {...args} valeurInitiale="+573001234567" />,
};

// Colombie par défaut (marché principal) — mais un client international garde son propre pays.
export const AutrePaysParDefaut: Story = {
  args: { ...BASE_ARGS, defaultCountry: "FR" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} />
      <Legende>defaultCountry=&quot;FR&quot; — l&apos;indicatif présélectionné change, jamais le composant.</Legende>
    </div>
  ),
};
