export type DiscountType = "fixed" | "percentage";
export type VatTreatment = "affects_vat" | "post_tax";
export type DocumentTotalLine = { quantity: number; unitPrice: number; discount?: number; discountType?: DiscountType; discountValue?: number; taxRateId?: string };
export type DocumentTaxRate = { id: string; rate_percent: number | string };
export type InvoiceAdjustment = { discountType?: DiscountType; discountValue?: number; vatTreatment?: VatTreatment; roundOff?: number };

const SCALE = 1_000_000;
const asMinor = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * SCALE);
const fromMinor = (value: number) => value / SCALE;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (base: number, rate: number) => Math.round(base * rate / 100);

/** Deterministic six-decimal calculation shared by forms, previews and tests. */
export function calculateBusinessDocumentTotals(lines: DocumentTotalLine[], taxRates: DocumentTaxRate[], adjustment: InvoiceAdjustment = {}) {
  const base = lines.map((line) => {
    const gross = Math.round(asMinor(line.quantity) * asMinor(line.unitPrice) / SCALE);
    const discountValue = line.discountValue ?? line.discount ?? 0;
    const requested = line.discountType === "percentage" ? percent(gross, clamp(discountValue, 0, 100)) : asMinor(discountValue);
    const lineDiscount = clamp(requested, 0, gross), net = gross - lineDiscount;
    const rate = Number(taxRates.find((tax) => tax.id === line.taxRateId)?.rate_percent || 0);
    return { gross, lineDiscount, net, rate };
  });
  const netTotal = base.reduce((sum, line) => sum + line.net, 0);
  const requestedInvoiceDiscount = adjustment.discountType === "percentage"
    ? percent(netTotal, clamp(adjustment.discountValue || 0, 0, 100)) : asMinor(adjustment.discountValue || 0);
  const invoiceDiscount = clamp(requestedInvoiceDiscount, 0, netTotal);
  let allocated = 0;
  const details = base.map((line, index) => {
    const allocation = index === base.length - 1 ? invoiceDiscount - allocated
      : netTotal === 0 ? 0 : Math.round(invoiceDiscount * line.net / netTotal);
    allocated += allocation;
    const taxableMinor = adjustment.vatTreatment === "post_tax" ? line.net : line.net - allocation;
    const vatMinor = percent(taxableMinor, line.rate);
    return { gross: fromMinor(line.gross), lineDiscount: fromMinor(line.lineDiscount), invoiceDiscountAllocation: fromMinor(allocation),
      net: fromMinor(line.net), taxable: fromMinor(taxableMinor), vat: fromMinor(vatMinor), total: fromMinor(taxableMinor + vatMinor) };
  });
  const gross = details.reduce((sum, line) => sum + line.gross, 0);
  const lineDiscount = details.reduce((sum, line) => sum + line.lineDiscount, 0);
  const taxable = details.reduce((sum, line) => sum + line.taxable, 0);
  const vat = details.reduce((sum, line) => sum + line.vat, 0);
  const postTaxDiscount = adjustment.vatTreatment === "post_tax" ? fromMinor(invoiceDiscount) : 0;
  const preTaxDiscount = adjustment.vatTreatment === "post_tax" ? 0 : fromMinor(invoiceDiscount);
  const roundOff = fromMinor(asMinor(adjustment.roundOff || 0));
  const subtotal = gross - lineDiscount;
  const total = taxable + vat - postTaxDiscount + roundOff;
  return { details, gross, subtotal, discount: lineDiscount, lineDiscount, invoiceDiscount: preTaxDiscount,
    postTaxDiscount, taxable, vat, roundOff, total };
}
