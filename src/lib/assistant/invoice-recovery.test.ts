import { describe, expect, it } from "vitest";
import { matchingRecentInvoiceDrafts } from "./invoice-recovery";

const args = { customerId: "c", documentDate: "2026-09-15", dueDate: "2026-09-30",
  reference: "QA-RECOVERY", notes: "Demo", items: [{ productId: "p", description: "Service",
    quantity: 2, unitPrice: 10, discount: 1, accountId: "a", taxRateId: "t" }] };
const candidate = { id: "draft-1", reference: "QA-RECOVERY", notes: "Demo" };
const line = { invoice_id: "draft-1", product_id: "p", description: "Service", quantity: "2.000000",
  unit_price: "10.000000", discount: "1.000000", revenue_account_id: "a", tax_rate_id: "t",
  inventory_location_id: null };

describe("ambiguous invoice recovery matcher", () => {
  it("finds a recent exact draft without a second create call", () => {
    expect(matchingRecentInvoiceDrafts(args, [candidate], [line])).toEqual(["draft-1"]);
  });
  it("rejects a line difference and leaves duplicate exact candidates unresolved", () => {
    expect(matchingRecentInvoiceDrafts(args, [candidate], [{ ...line, quantity: "3" }])).toEqual([]);
    expect(matchingRecentInvoiceDrafts(args, [candidate, { ...candidate, id: "draft-2" }],
      [line, { ...line, invoice_id: "draft-2" }])).toEqual(["draft-1", "draft-2"]);
  });
});
