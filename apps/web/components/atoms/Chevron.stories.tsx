import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Chevron } from "./Chevron";

const meta = {
  title: "Affichage/Chevron",
  component: Chevron,
  parameters: { layout: "centered" },
  args: { ouvert: false },
} satisfies Meta<typeof Chevron>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

export const Abierto: Story = {
  args: { ouvert: true },
};
