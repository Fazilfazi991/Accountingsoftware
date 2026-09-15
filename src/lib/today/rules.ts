import { addDays, amount, type OpenItem, openItemTotals } from "./calculations";

export type Attention = { id: string; title: string; detail: string; amount: number; rank: number; href: string; action: string };

// Collections precede obligations; within a class, overdue age and materiality rank the items.
// Due-soon obligations never outrank an overdue receivable. No synthetic bookkeeping warnings.
export function attentionEngine(receivables: OpenItem[], payables: OpenItem[], today: string): Attention[] {
  const ar = openItemTotals(receivables, today);
  const ap = openItemTotals(payables, today);
  const items: Attention[] = [];
  for (const item of ar.overdue) {
    const age = Math.max(1, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${item.due_date}T12:00:00Z`)) / 86400000));
    items.push({ id: item.open_item_id, title: `${item.party_name} · overdue collection`, detail: `${item.document_number || "Invoice"} · ${age} days overdue`,
      amount: amount(item.outstanding), rank: 400000 + Math.min(age, 365) * 1000 + Math.min(amount(item.outstanding), 999),
      href: `/sales/invoices/${item.document_id}`, action: "Review & collect" });
  }
  for (const item of ap.active.filter((row) => row.due_date && row.due_date <= addDays(today, 7))) {
    const late = Boolean(item.due_date && item.due_date < today);
    items.push({ id: item.open_item_id, title: `${item.party_name} · ${late ? "overdue bill" : "bill due soon"}`,
      detail: `${item.document_number || "Bill"} · ${item.due_date}`, amount: amount(item.outstanding),
      rank: (late ? 300000 : 200000) + Math.min(amount(item.outstanding), 99999) / 100,
      href: `/purchases/bills/${item.document_id}`, action: "Review payments" });
  }
  return items.sort((a, b) => b.rank - a.rank || b.amount - a.amount || a.id.localeCompare(b.id));
}

// Only a genuinely overdue, open customer invoice can generate a collection recommendation.
export function collectionRecommendation(items: OpenItem[], today: string) {
  const candidate = attentionEngine(items, [], today)[0];
  return candidate ? { ...candidate, heading: `Collect from ${candidate.title.split(" · ")[0]} today.`,
    explanation: `${candidate.detail}. Review the open invoice before contacting the customer.` } : null;
}

// Start at 100; -15 for any overdue receivable, -10 more for 30+ days,
// -10 for overdue payable, -5 for bills due within seven days, -15 if available cash
// is below the next-seven-day payable amount. No missing-data component is scored.
export function businessHealth(overdueReceivables: OpenItem[], payables: OpenItem[], cash: number, today: string) {
  const overdue = openItemTotals(overdueReceivables, today).overdue;
  const obligations = openItemTotals(payables, today);
  const deductions = [
    overdue.length ? 15 : 0,
    overdue.some((row) => row.due_date && row.due_date < addDays(today, -30)) ? 10 : 0,
    obligations.overdue.length ? 10 : 0,
    obligations.next7.length ? 5 : 0,
    cash < obligations.next7Amount && obligations.next7Amount > 0 ? 15 : 0,
  ];
  const score = Math.max(0, 100 - deductions.reduce((s, n) => s + n, 0));
  return { score, label: score >= 80 ? "Good" : score >= 60 ? "Watch" : "Needs attention" };
}
