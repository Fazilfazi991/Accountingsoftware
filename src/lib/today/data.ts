import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { requireOrganizationContext } from "@/lib/organization-context";
import { addDays, amount, monthPeriods, moneyNow, openItemTotals, todayActivity, comparePeriod, type OpenItem, type DatedAmount } from "./calculations";
import { attentionEngine, businessHealth, collectionRecommendation } from "./rules";

type Context = Awaited<ReturnType<typeof requireOrganizationContext>>;
type Dashboard = { cash_on_hand: number; cash_at_bank: number; receivables: number; payables: number };
type ProfitLoss = { revenue: number; cogs: number; expenses: number; netProfit: number };

export type TodayData = Awaited<ReturnType<typeof getTodayData>>;

export async function getTodayData(context: Context, today: string) {
  const client = await createClient();
  const org = context.organization.id, branch = context.branch.id;
  const periods = monthPeriods(today);
  const rpc = (name: string, args: Record<string, unknown>) => client.rpc(name, { p_organization_id: org, p_branch_id: branch, ...args });
  const open = (kind: "receivable" | "payable") => rpc("get_open_item_report", { p_kind: kind, p_state: "open", p_as_of: today }).range(0, 1000);
  const onDay = (table: string, date: string, field: string) => client.from(table).select(`${date},${field},status`)
    .eq("organization_id", org).eq("branch_id", branch).eq("status", "posted").eq(date, today).range(0, 1000);
  const [dashboard, receivables, payables, current, previous, receipts, payments, expenses, invoices, bills] = await Promise.all([
    rpc("get_live_dashboard", {}), open("receivable"), open("payable"),
    rpc("get_profit_and_loss", { p_from: periods.currentFrom, p_to: today }),
    rpc("get_profit_and_loss", { p_from: periods.previousFrom, p_to: periods.previousTo }),
    onDay("customer_receipts", "receipt_date", "amount"), onDay("supplier_payments", "payment_date", "amount"),
    onDay("expenses", "expense_date", "total_amount"), onDay("sales_invoices", "invoice_date", "grand_total"),
    onDay("purchase_bills", "bill_date", "grand_total"),
  ]);
  const warnings: string[] = [];
  const dashboardData = !dashboard.error && dashboard.data ? dashboard.data as Dashboard : null;
  if (!dashboardData) warnings.push("Posted cash and outstanding balances are unavailable.");
  const validOpen = (result: typeof receivables, label: string): OpenItem[] | null => {
    if (result.error || !result.data || result.data.length > 1000) {
      warnings.push(`${label} due-date details are unavailable${result.data?.length ? " (too many open items)" : ""}.`);
      return null;
    }
    return (result.data as OpenItem[]).map((row) => ({ ...row, outstanding: amount(row.outstanding) }));
  };
  let ar = validOpen(receivables, "Customer"), ap = validOpen(payables, "Supplier");
  // A future-dated source document or reversal can make the report's as-of rows
  // differ from the dashboard's current open-item total. Never publish a partial
  // due-window sum as if it covered the same population as the exact AR/AP card.
  if (dashboardData && ar && Math.abs(openItemTotals(ar, today).outstanding - amount(dashboardData.receivables)) > 0.005) {
    warnings.push("Customer open-item details do not reconcile to the posted AR balance."); ar = null;
  }
  if (dashboardData && ap && Math.abs(openItemTotals(ap, today).outstanding - amount(dashboardData.payables)) > 0.005) {
    warnings.push("Supplier open-item details do not reconcile to the posted AP balance."); ap = null;
  }
  const extract = (result: typeof receipts, date: string, field: string): DatedAmount[] | null => {
    if (result.error || !result.data || result.data.length > 1000) return null;
    return result.data.map((value) => { const row = value as unknown as Record<string, unknown>;
      return { date: String(row[date]), amount: amount(row[field]), status: String(row.status) }; });
  };
  const activityRows = [extract(receipts, "receipt_date", "amount"), extract(payments, "payment_date", "amount"),
    extract(expenses, "expense_date", "total_amount"), extract(invoices, "invoice_date", "grand_total"),
    extract(bills, "bill_date", "grand_total")];
  if (activityRows.some((rows) => rows === null)) warnings.push("Some same-day activity is unavailable; no partial daily total is shown.");
  const activity = activityRows.every((rows) => rows !== null)
    ? todayActivity(activityRows[0]!, activityRows[1]!, activityRows[2]!, activityRows[3]!, activityRows[4]!, today) : null;
  const currentReport = !current.error && current.data ? current.data as ProfitLoss : null;
  const previousReport = !previous.error && previous.data ? previous.data as ProfitLoss : null;
  if (!currentReport || !previousReport) warnings.push("Ledger month comparison is unavailable.");
  const pulse = currentReport && previousReport ? {
    revenue: comparePeriod(amount(currentReport.revenue), amount(previousReport.revenue)),
    expenses: comparePeriod(amount(currentReport.expenses) + amount(currentReport.cogs), amount(previousReport.expenses) + amount(previousReport.cogs)),
    netResult: amount(currentReport.netProfit), outstanding: dashboardData ? amount(dashboardData.receivables) : null,
    overdue: ar ? openItemTotals(ar, today).overdueAmount : null,
    comparison: `${periods.currentFrom}–${today} vs ${periods.previousFrom}–${periods.previousTo}`,
  } : null;
  const dueAR = ar ? openItemTotals(ar, today) : null, dueAP = ap ? openItemTotals(ap, today) : null;
  const money = dashboardData && dueAR && dueAP ? moneyNow(amount(dashboardData.cash_on_hand), amount(dashboardData.cash_at_bank), dueAR.next7Amount, dueAP.next7Amount) : null;
  const attention = ar && ap ? attentionEngine(ar, ap, today) : null;
  const health = money && ar && ap ? businessHealth(ar, ap, money.now, today) : null;
  const recommendation = ar ? collectionRecommendation(ar, today) : null;
  const upcoming = ar && ap ? [
    ...dueAR!.next7.map((item) => ({ ...item, kind: "Customer invoice due", href: `/sales/invoices/${item.document_id}` })),
    ...dueAP!.next7.map((item) => ({ ...item, kind: "Supplier bill due", href: `/purchases/bills/${item.document_id}` })),
  ].sort((a, b) => (a.due_date || "").localeCompare(b.due_date || "") || b.outstanding - a.outstanding).slice(0, 5) : null;
  const status = attention === null ? "Some financial details could not be loaded. Review the available figures below."
    : attention.some((item) => item.title.includes("overdue collection")) ? "Collections need your attention today."
      : attention.length ? "Supplier obligations need a look this week."
        : dueAR && dueAR.next7Amount > 0 ? "Nothing urgent today. Customer collections are expected this week."
          : "Nothing urgent needs your attention today.";
  return { today, organization: context.payload.organization.name, branch: context.payload.branch.name,
    currency: context.payload.organization.currency || "AED", timezone: context.payload.organization.timezone || "Asia/Dubai",
    name: context.payload.user.displayName.split(/\s+/)[0], status, health, money, attention, activity, pulse,
    upcoming, recommendation, nextCollections: dueAR?.next7Amount ?? null,
    hasData: Boolean(dashboardData && (dashboardData.cash_on_hand || dashboardData.cash_at_bank || dashboardData.receivables || dashboardData.payables ||
      currentReport?.revenue || currentReport?.expenses || currentReport?.cogs || activity && Object.values(activity).some(Boolean))),
    warnings, horizon: addDays(today, 7) };
}
