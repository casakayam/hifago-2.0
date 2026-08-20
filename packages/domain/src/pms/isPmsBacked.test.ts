import { describe, expect, it } from "vitest";
import { isPmsBacked } from "./isPmsBacked";

describe("isPmsBacked", () => {
  it("lodging avec lobby_category_id → PMS-backed", () => {
    expect(isPmsBacked({ type: "lodging", lobbyCategoryId: 9631 })).toBe(true);
  });

  it("lodging sans lobby_category_id → non PMS-backed (calendrier interne fait foi)", () => {
    expect(isPmsBacked({ type: "lodging", lobbyCategoryId: null })).toBe(false);
  });

  it.each(["activity", "hotel", "transport", "camp", "evento"])(
    "type=%s avec lobby_category_id renseigné reste non PMS-backed (réservé au lodging)",
    (type) => {
      expect(isPmsBacked({ type, lobbyCategoryId: 9631 })).toBe(false);
    }
  );
});
