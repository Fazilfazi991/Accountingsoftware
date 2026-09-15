import { expect, it } from "vitest";
import { calculateBusinessDocumentTotals } from "./business-document-totals";

it("shares invoice preview totals with the full form without Assistant-owned arithmetic", () => {
  const totals = calculateBusinessDocumentTotals([
    { quantity: 10, unitPrice: 120, discount: 100, taxRateId: "standard" },
    { quantity: 1, unitPrice: 200, discount: 0, taxRateId: "zero" },
  ], [{ id: "standard", rate_percent: 5 }, { id: "zero", rate_percent: 0 }]);
  expect(totals).toMatchObject({ subtotal: 1300, discount: 100, vat: 55, total: 1355 });
  expect(totals.details).toHaveLength(2);
});
