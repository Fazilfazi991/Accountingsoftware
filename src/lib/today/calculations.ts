export type OpenItem = {
  open_item_id: string; party_name: string; document_id: string; document_number: string;
  due_date: string | null; outstanding: number; item_status: string;
};
export type DatedAmount = { date: string; amount: number; status: string };

export const amount = (value: unknown) => Number(value || 0);
export const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + amount(item.amount), 0);

export function addDays(day: string, count: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function monthPeriods(day: string) {
  const [year, month] = day.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const previousDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const comparableDay = Math.min(Number(day.slice(8)), previousDays);
  return { currentFrom: `${day.slice(0, 7)}-01`, previousFrom: `${previous}-01`, previousTo: `${previous}-${String(comparableDay).padStart(2, "0")}` };
}

export function openItemTotals(items: OpenItem[], today: string) {
  const horizon = addDays(today, 7);
  const active = items.filter((item) => ["open", "partial"].includes(item.item_status) && amount(item.outstanding) > 0);
  const overdue = active.filter((item) => item.due_date && item.due_date < today);
  const next7 = active.filter((item) => item.due_date && item.due_date >= today && item.due_date <= horizon);
  return { active, overdue, next7, outstanding: active.reduce((s, item) => s + amount(item.outstanding), 0),
    overdueAmount: overdue.reduce((s, item) => s + amount(item.outstanding), 0),
    next7Amount: next7.reduce((s, item) => s + amount(item.outstanding), 0) };
}

export function moneyNow(cash: number, bank: number, coming: number, going: number) {
  const now = amount(cash) + amount(bank);
  return { now, coming, going, projected: now + coming - going };
}

export function todayActivity(receipts: DatedAmount[], payments: DatedAmount[], expenses: DatedAmount[], invoices: DatedAmount[], bills: DatedAmount[], day: string) {
  const posted = (rows: DatedAmount[]) => sum(rows.filter((row) => row.status === "posted" && row.date === day));
  return { received: posted(receipts), spent: posted(payments) + posted(expenses), invoiced: posted(invoices), purchases: posted(bills) };
}

export function comparePeriod(current: number, previous: number) {
  return { current: amount(current), previous: amount(previous), difference: amount(current) - amount(previous),
    percent: previous === 0 ? null : (amount(current) - amount(previous)) / Math.abs(previous) * 100 };
}
