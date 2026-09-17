import { describe, expect, it } from "vitest";
import { calculateBusinessDocumentTotals } from "./business-document-totals";
const vat = [{ id: "vat5", rate_percent: 5 }];
describe("invoice calculation V2", () => {
  it("supports percentage and fixed line discounts", () => {
    expect(calculateBusinessDocumentTotals([{ quantity: 10, unitPrice: 100, discountType: "percentage", discountValue: 10, taxRateId: "vat5" }], vat)).toMatchObject({ gross: 1000, lineDiscount: 100, taxable: 900, vat: 45, total: 945 });
    expect(calculateBusinessDocumentTotals([{ quantity: 10, unitPrice: 100, discountType: "fixed", discountValue: 100 }], vat).subtotal).toBe(900);
  });
  it("allocates VAT-affecting invoice discount across rates", () => {
    const result = calculateBusinessDocumentTotals([{ quantity: 1, unitPrice: 1000, taxRateId: "vat5" }, { quantity: 1, unitPrice: 1000 }], vat,
      { discountType: "percentage", discountValue: 5, vatTreatment: "affects_vat" });
    expect(result.invoiceDiscount).toBe(100); expect(result.details.map((line) => line.invoiceDiscountAllocation)).toEqual([50, 50]);
    expect(result.vat).toBe(47.5); expect(result.total).toBe(1947.5);
  });
  it("keeps VAT unchanged for a post-tax discount and applies round off", () => {
    const result = calculateBusinessDocumentTotals([{ quantity: 1, unitPrice: 1000, taxRateId: "vat5" }], vat,
      { discountType: "fixed", discountValue: 100, vatTreatment: "post_tax", roundOff: 0.03 });
    expect(result).toMatchObject({ taxable: 1000, vat: 50, postTaxDiscount: 100, roundOff: 0.03, total: 950.03 });
  });
});
