import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Textarea } from "./Textarea";
import { Field } from "./Field";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
function rendu(element: React.ReactElement) {
  const { container } = render(element);
  return {
    container,
    zone: container.querySelector("textarea") as HTMLTextAreaElement,
    racine: container.firstElementChild as HTMLElement,
  };
}

describe("Textarea", () => {
  it("rend un <textarea> avec son libellé, sa valeur et ses lignes", () => {
    const { container, zone } = rendu(
      <Textarea label="Mensaje" value="Hola" onChange={() => {}} rows={5} testId="msg" />
    );
    expect(zone.tagName).toBe("TEXTAREA");
    expect(zone.value).toBe("Hola");
    expect(zone.getAttribute("rows")).toBe("5");
    expect((container.querySelector("label") as HTMLLabelElement).getAttribute("for")).toBe(zone.id);
  });

  it("remonte la saisie", () => {
    const onChange = vi.fn();
    const { zone } = rendu(<Textarea label="Mensaje" value="" onChange={onChange} />);
    fireEvent.change(zone, { target: { value: "Buenas" } });
    expect(onChange).toHaveBeenCalledWith("Buenas");
  });

  it("annonce qu'il est requis sans poser la contrainte native (même règle que Field)", () => {
    const { zone } = rendu(<Textarea label="Mensaje" value="" onChange={() => {}} isRequired />);
    expect(zone.getAttribute("aria-required")).toBe("true");
    expect(zone.hasAttribute("required")).toBe(false);
  });

  it("relie erreur et texte d'aide au champ", () => {
    const { container, zone } = rendu(
      <Textarea label="Mensaje" value="" onChange={() => {}} hint="Máx. 500" error="Demasiado corto" testId="msg" />
    );
    expect(zone.getAttribute("aria-invalid")).toBe("true");
    const decrits = zone.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(decrits).toContain((container.querySelector('[data-testid="msg-hint"]') as HTMLElement).id);
    expect(decrits).toContain((container.querySelector('[data-testid="msg-error"]') as HTMLElement).id);
  });

  // ⚠️ Le garde-fou qui justifie la table partagée : un formulaire met un `Field` et un `Textarea`
  // l'un au-dessus de l'autre, et deux tables recopiées auraient divergé au premier ajustement.
  it("partage exactement les largeurs de Field", () => {
    for (const width of ["full", "short", "grow"] as const) {
      const champ = rendu(<Field label="A" value="" onChange={() => {}} width={width} />).racine.className;
      const zone = rendu(<Textarea label="A" value="" onChange={() => {}} width={width} />).racine.className;
      expect(zone).toBe(champ);
    }
  });

  it("se désactive", () => {
    expect(rendu(<Textarea label="A" value="" onChange={() => {}} isDisabled />).zone.hasAttribute("disabled")).toBe(true);
  });
});
