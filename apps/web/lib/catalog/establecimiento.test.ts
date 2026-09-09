import { describe, expect, it } from "vitest";
import { urlDeContacto } from "./establecimiento";

describe("urlDeContacto", () => {
  it("retire le + que wa.me n'accepte pas", () => {
    expect(urlDeContacto("+573001234567")).toBe("https://wa.me/573001234567");
  });

  it("laisse intact un numéro déjà sans +", () => {
    // Impossible en base (la contrainte `establishments_contact_phone_e164` exige le `+`), mais la
    // fonction ne doit pas mutiler ce qu'elle reçoit si la contrainte changeait un jour.
    expect(urlDeContacto("573001234567")).toBe("https://wa.me/573001234567");
  });

  it("ne retire QUE le + de tête", () => {
    expect(urlDeContacto("+57300+123")).toBe("https://wa.me/57300+123");
  });
});
