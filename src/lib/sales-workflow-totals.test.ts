import { describe, expect, it } from "vitest";
import { calculateOperationalTotals } from "./sales-workflow-totals";

describe("Quotation totals shared with the normal list", () => {
  it("matches persisted and guided line shapes, including discounts and VAT", () => {
    const rates = [{ id: "vat", rate_percent: 5 }];
    const persisted = calculateOperationalTotals([{ quantity: "2", unit_price: "10", discount: "3", tax_rate_id: "vat" }], rates);
    const guided = calculateOperationalTotals([{ quantity: 2, unitPrice: 10, discount: 3, taxRateId: "vat" }], rates);
    expect(persisted).toEqual(guided);
    expect(guided).toMatchObject({ subtotal: 17, discount: 3, vat: 0.85, total: 17.85 });
  });
});
