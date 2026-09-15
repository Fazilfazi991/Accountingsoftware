import type { InvoiceActionArgs } from "./action-registry";

type PersistedLine = {
  invoice_id: string; product_id: string | null; description: string;
  quantity: number | string; unit_price: number | string; discount: number | string;
  revenue_account_id: string | null; tax_rate_id: string | null;
  inventory_location_id: string | null;
};
type Candidate = { id: string; reference: string | null; notes: string | null };

const numeric = (value: number | string) => Number(value).toFixed(6);
const text = (value: string | null | undefined) => value?.trim() || "";
const key = (line: {
  product: string | null; description: string; quantity: number | string;
  price: number | string; discount: number | string; account: string | null;
  tax?: string | null; location?: string | null;
}) => JSON.stringify([line.product, text(line.description), numeric(line.quantity),
  numeric(line.price), numeric(line.discount), line.account, line.tax || null, line.location || null]);

/** Exact line matching is a recovery signal, not a persisted idempotency token. */
export function matchingRecentInvoiceDrafts(args: InvoiceActionArgs,
  candidates: readonly Candidate[], persistedLines: readonly PersistedLine[]): string[] {
  const expected = args.items.map((line) => key({ product: line.productId, description: line.description,
    quantity: line.quantity, price: line.unitPrice, discount: line.discount,
    account: line.accountId, tax: line.taxRateId, location: line.locationId })).sort();
  return candidates.filter((candidate) => {
    if (text(candidate.reference) !== text(args.reference) || text(candidate.notes) !== text(args.notes)) return false;
    const actual = persistedLines.filter((line) => line.invoice_id === candidate.id)
      .map((line) => key({ product: line.product_id, description: line.description,
        quantity: line.quantity, price: line.unit_price, discount: line.discount,
        account: line.revenue_account_id, tax: line.tax_rate_id, location: line.inventory_location_id })).sort();
    return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
  }).map((candidate) => candidate.id);
}
