type OperationalLine = {
  quantity: number | string; discount?: number | string | null;
  unitPrice?: number | string; unit_price?: number | string;
  taxRateId?: string | null; tax_rate_id?: string | null;
};
type TaxRate = { id: string; rate_percent: number | string };

/** Same line arithmetic used by the ordinary Quotation and Delivery Note list. */
export function calculateOperationalTotals(lines: readonly OperationalLine[], taxRates: readonly TaxRate[]) {
  const details = lines.map((line) => {
    const gross = Number(line.quantity) * Number(line.unitPrice ?? line.unit_price ?? 0);
    const discount = Number(line.discount || 0);
    const net = gross - discount;
    const taxId = line.taxRateId ?? line.tax_rate_id;
    const rate = Number(taxRates.find((tax) => tax.id === taxId)?.rate_percent || 0);
    const vat = net * rate / 100;
    return { gross, discount, net, vat, total: net * (1 + rate / 100) };
  });
  return {
    subtotal: details.reduce((sum, line) => sum + line.net, 0),
    discount: details.reduce((sum, line) => sum + line.discount, 0),
    vat: details.reduce((sum, line) => sum + line.vat, 0),
    total: details.reduce((sum, line) => sum + line.total, 0), details,
  };
}
