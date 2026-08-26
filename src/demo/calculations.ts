export type VatRate = "standard" | "zero" | "exempt" | "out-of-scope";
export type InvoiceLineInput = { quantity: number; rate: number; discount?: number; vatRate: VatRate };

export const vatPercent = (rate: VatRate) => rate === "standard" ? 0.05 : 0;
export function calculateInvoice(lines: InvoiceLineInput[], amountPaid = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.rate, 0);
  const discount = lines.reduce((sum, line) => sum + (line.discount ?? 0), 0);
  const taxable = lines.reduce((sum, line) => sum + Math.max(0, line.quantity * line.rate - (line.discount ?? 0)), 0);
  const vat = lines.reduce((sum, line) => sum + Math.max(0, line.quantity * line.rate - (line.discount ?? 0)) * vatPercent(line.vatRate), 0);
  const total = taxable + vat;
  const balance = Math.max(0, total - amountPaid);
  return { subtotal, discount, taxable, vat, total, amountPaid, balance };
}
export function paymentStatus(total: number, paid: number) {
  if (paid <= 0) return "Posted";
  if (paid >= total) return "Paid";
  return "Partially Paid";
}
export function journalDifference(lines: Array<{ debit: number; credit: number }>) {
  return lines.reduce((sum, line) => sum + line.debit - line.credit, 0);
}
export function convertQuotationToInvoice<T extends { lines: InvoiceLineInput[]; customerId: string; date: string }>(quotation: T) {
  return { customerId: quotation.customerId, date: quotation.date, dueDate: quotation.date, status: "Draft", lines: quotation.lines, amountPaid: 0 };
}
export function eligibleCredit(remainingBalance: number, requestedCredit: number) { return Math.max(0, Math.min(remainingBalance, requestedCredit)); }
export function mutateStock(quantity: number, movement: "purchase" | "sale" | "credit" | "return", amount: number) { return quantity + (movement === "purchase" || movement === "credit" ? amount : -amount); }
export function vatPosition(outputVat: number, inputVat: number) { return outputVat - inputVat; }
export function reconciliationMatch<T extends { id: string; matchedTo?: string }>(items: T[], id: string, matchedTo: string) { return items.map(item => item.id === id ? { ...item, matchedTo } : item); }
export function reconciliationUnmatch<T extends { id: string; matchedTo?: string }>(items: T[], id: string) { return items.map(item => item.id === id ? { ...item, matchedTo: undefined } : item); }
export function statementBalances(rows: Array<{ debit: number; credit: number }>) { let balance = 0; return rows.map(row => (balance += row.debit - row.credit)); }
