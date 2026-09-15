export type OpenItem = { open_item_id: string; party_id: string; party_name: string; document_id: string; document_number: string;
  due_date: string | null; document_date: string; outstanding: number; age_days: number };
const n = (value: unknown) => Number(value ?? 0);
export const classifyDue = (items: OpenItem[], today: string, from?: string, to?: string, minimum = 0) => {
  const visible = items.filter((item) => (item.due_date || item.document_date) >= (from || "0000-01-01") &&
    (item.due_date || item.document_date) <= (to || "9999-12-31") && n(item.outstanding) >= minimum);
  return { current: visible.filter((item) => (item.due_date || item.document_date) >= today),
    overdue: visible.filter((item) => (item.due_date || item.document_date) < today),
    total: visible.reduce((sum, item) => sum + n(item.outstanding), 0) };
};
export const groupOverdue = (items: OpenItem[], today: string, minimum = 0) => {
  const grouped = new Map<string, { party: string; id: string; amount: number; oldest: number }>();
  for (const item of classifyDue(items, today).overdue) {
    const previous = grouped.get(item.party_id), due = item.due_date || item.document_date;
    const days = Math.max(0, Math.floor((Date.parse(today) - Date.parse(due)) / 86400000));
    grouped.set(item.party_id, { party: item.party_name, id: item.party_id,
      amount: (previous?.amount || 0) + n(item.outstanding), oldest: Math.max(previous?.oldest || 0, days) });
  }
  return [...grouped.values()].filter((party) => party.amount >= minimum).sort((a, b) => b.amount - a.amount);
};
export const cashPosition = (cash: number, bank: number) => n(cash) + n(bank);
export const vatPosition = (output: number, input: number) => n(output) - n(input);
export const profitBridge = (revenue: number, cogs: number, expenses: number) => n(revenue) - n(cogs) - n(expenses);
