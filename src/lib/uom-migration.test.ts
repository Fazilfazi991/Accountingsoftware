import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260917085932_units_v2.sql", "utf8");

describe("Units V2 database contract", () => {
  it("stores secondary conversion settings and immutable transaction snapshots", () => {
    expect(migration).toContain("secondary_conversion_factor numeric(24,12)");
    expect(migration).toContain("transaction_unit_code text");
    expect(migration).toContain("transaction_unit_price numeric(24,12)");
  });
  it("normalizes stock through the existing stock operation boundary", () => {
    expect(migration).toContain("post_stock_operation_uom");
    expect(migration).toContain("public.post_stock_operation(");
    expect(migration).toContain("v_uom.normalized_quantity");
  });
  it("keeps tenant checks and privileged UOM helpers private", () => {
    expect(migration).toContain("public.assert_org_capability(p_org,'inventory.manage')");
    expect(migration).toContain("revoke all on function public.resolve_product_uom");
    expect(migration).toContain("enable row level security");
  });
});
