import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Chevron } from "./Chevron";

describe("Chevron", () => {
  it("rend un svg décoratif, sans rotation par défaut", () => {
    const { getByTestId } = render(<Chevron ouvert={false} testId="chevron" />);
    const svg = getByTestId("chevron");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).not.toContain("rotate-180");
  });

  it("pivote quand ouvert", () => {
    const { getByTestId } = render(<Chevron ouvert={true} testId="chevron" />);
    expect(getByTestId("chevron").getAttribute("class")).toContain("rotate-180");
  });
});
