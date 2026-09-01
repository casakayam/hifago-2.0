import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button, Card, Input, Label, TextField } from "@hifago/ui";

// Les primitives HeroUI sur lesquelles les futurs atomes seront composés, vues AVEC les tokens du
// projet. Volontairement minimal : documenter tout HeroUI reviendrait à recopier sa documentation.
//
// Cette story sert aussi de test de la chaîne : si Tailwind, HeroUI et le thème ne sont pas
// correctement branchés dans le playground, c'est ici que ça se voit en premier.
const meta = {
  title: "Playground/Socle",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Boutons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button isDisabled>Désactivé</Button>
    </div>
  ),
};

export const Champs: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <TextField name="nom">
        <Label>Nom</Label>
        <Input placeholder="Ada Lovelace" />
      </TextField>
      <TextField name="email">
        <Label>Courriel</Label>
        <Input type="email" placeholder="ada@example.com" />
      </TextField>
    </div>
  ),
};

export const Carte: Story = {
  render: () => (
    // ⚠️ `h-80` est ici DÉLIBÉRÉ et ne doit pas être « nettoyé » : c'est une classe qu'aucun autre
    // fichier d'apps/web n'utilise. Si la carte fait bien 20rem de haut, c'est la preuve que
    // Tailwind scanne réellement ce dossier sous Vite — le piège n°1 de ce lot.
    <Card className="h-80 max-w-sm">
      <Card.Header>
        <Card.Title>Titre de carte</Card.Title>
        <Card.Description>Sous-titre descriptif.</Card.Description>
      </Card.Header>
      <Card.Content>Contenu.</Card.Content>
    </Card>
  ),
};
