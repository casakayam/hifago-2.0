import { describe, expect, it } from "vitest";
import { migasParaJsonLd } from "./migas";

describe("migasParaJsonLd", () => {
  const migas = [
    { nombre: "Inicio", href: "/" },
    { nombre: "Alojamientos", href: "/alojamientos" },
    { nombre: "Cabaña del Lago" },
  ];

  it("préfixe chaque chemin par la locale — le JSON-LD déclare des URL absolues", () => {
    expect(migasParaJsonLd(migas, "es", "/productos/cabana").map((i) => i.path)).toEqual([
      "/es/",
      "/es/alojamientos",
      "/es/productos/cabana",
    ]);
  });

  it("donne au DERNIER élément sa route canonique — il n'a pas de href", () => {
    // La page courante n'est pas un lien vers elle-même côté visible, mais le JSON-LD doit lui
    // donner un chemin : celui-là même que `generateMetadata` déclare en canonical.
    const jsonLd = migasParaJsonLd(migas, "en", "/productos/cabana");
    expect(jsonLd.at(-1)).toEqual({ name: "Cabaña del Lago", path: "/en/productos/cabana" });
  });

  it("conserve l'ordre et le nombre d'entrées — visible et JSON-LD ne peuvent pas diverger", () => {
    const jsonLd = migasParaJsonLd(migas, "es", "/productos/cabana");
    expect(jsonLd.map((i) => i.name)).toEqual(migas.map((m) => m.nombre));
  });

  it("suit la locale sans rien traduire", () => {
    expect(migasParaJsonLd([{ nombre: "Inicio", href: "/" }], "en", "/")[0].path).toBe("/en/");
  });
});
