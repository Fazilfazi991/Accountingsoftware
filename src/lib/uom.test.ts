import { describe, expect, it } from "vitest";
import { normalizeToPrimary, rateForUnit, validProductUnits } from "./uom";

const box = {
  unit_id: "box", secondary_unit_id: "pcs", secondary_conversion_factor: "10",
  inventory_units: { code: "BOX", name: "Box" }, secondary_unit: { code: "PCS", name: "Pieces" },
};

describe("UOM conversion", () => {
  it("normalizes secondary quantities without binary floating-point arithmetic", () => {
    expect(normalizeToPrimary("5", "pcs", box)).toBe("0.5");
    expect(normalizeToPrimary("25", "kg", { ...box, secondary_unit_id: "kg", secondary_conversion_factor: "50" })).toBe("0.5");
    expect(normalizeToPrimary("0.3", "box", box)).toBe("0.3");
  });
  it("derives economically equivalent secondary rates", () => {
    expect(rateForUnit("100", "pcs", box)).toBe("10");
    expect(Number(rateForUnit("100", "pcs", box)) * 10).toBe(100);
  });
  it("offers only units configured on the product", () => {
    expect(validProductUnits(box).map((unit) => unit.code)).toEqual(["BOX", "PCS"]);
  });
  it("rejects unrelated units", () => {
    expect(() => normalizeToPrimary("1", "kg", box)).toThrow("invalid_product_unit");
  });
});
