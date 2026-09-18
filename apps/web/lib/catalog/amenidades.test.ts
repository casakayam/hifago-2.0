import { describe, expect, it } from "vitest";
import { agruparAmenidadesPorCategoria, type FilaAmenidad } from "./amenidades";

function fila(
  label: unknown,
  sortOrderItem: number,
  categoriaLabel: unknown,
  sortOrderCategoria: number
): FilaAmenidad {
  return {
    amenity: {
      label,
      sort_order: sortOrderItem,
      category: { label: categoriaLabel, sort_order: sortOrderCategoria },
    },
  };
}

describe("agruparAmenidadesPorCategoria", () => {
  it("regroupe par catégorie et respecte sort_order des catégories puis des items", () => {
    const filas: FilaAmenidad[] = [
      fila({ es: "Jacuzzi" }, 30, { es: "Piscina y bienestar" }, 90),
      fila({ es: "Wifi" }, 10, { es: "Servicios básicos" }, 10),
      fila({ es: "Piscina privada" }, 10, { es: "Piscina y bienestar" }, 90),
      fila({ es: "Agua caliente" }, 20, { es: "Servicios básicos" }, 10),
    ];

    const resultado = agruparAmenidadesPorCategoria(filas, "es");

    expect(resultado).toEqual([
      { categoria: "Servicios básicos", items: ["Wifi", "Agua caliente"] },
      { categoria: "Piscina y bienestar", items: ["Piscina privada", "Jacuzzi"] },
    ]);
  });

  it("ignore une ligne dont la catégorie ou le libellé résolu est vide", () => {
    const filas: FilaAmenidad[] = [
      { amenity: null },
      { amenity: { label: { es: "Wifi" }, sort_order: 1, category: null } },
    ];

    expect(agruparAmenidadesPorCategoria(filas, "es")).toEqual([]);
  });

  it("replie sur la locale es quand en est absent", () => {
    const filas: FilaAmenidad[] = [fila({ es: "Muelle privado" }, 10, { es: "Entorno" }, 10)];

    expect(agruparAmenidadesPorCategoria(filas, "en")).toEqual([
      { categoria: "Entorno", items: ["Muelle privado"] },
    ]);
  });

  it("résout en anglais quand la traduction existe", () => {
    const filas: FilaAmenidad[] = [
      fila({ es: "Wifi", en: "Wifi" }, 10, { es: "Servicios básicos", en: "Basic services" }, 10),
    ];

    expect(agruparAmenidadesPorCategoria(filas, "en")).toEqual([
      { categoria: "Basic services", items: ["Wifi"] },
    ]);
  });
});
