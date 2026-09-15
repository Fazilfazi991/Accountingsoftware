export type DocumentTotalLine = { quantity: number; unitPrice: number; discount: number; taxRateId?: string };
export type DocumentTaxRate = { id: string; rate_percent: number | string };

/** Shared preview calculation used by the full document form and guided Assistant.
 * The posting RPC remains the authority for booked amounts and rounds to six decimals.
 */
export function calculateBusinessDocumentTotals(lines: DocumentTotalLine[], taxRates: DocumentTaxRate[]) {
  const details = lines.map((line) => {
    const net = Math.max(0, line.quantity * line.unitPrice - line.discount);
    const rate = taxRates.find((tax) => tax.id === line.taxRateId);
    const vat = net * Number(rate?.rate_percent || 0) / 100;
    return { net, vat, total: net + vat };
  });
  const subtotal = details.reduce((sum, line) => sum + line.net, 0);
  const vat = details.reduce((sum, line) => sum + line.vat, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount, 0);
  return { details, subtotal, discount, vat, total: subtotal + vat };
}
