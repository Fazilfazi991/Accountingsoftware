import "server-only";
import { dubaiCalendarDate } from "@/lib/dubai-date";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { safeLink, validatePlan } from "./registry";
import { classifyDue, groupOverdue, type OpenItem } from "./metrics";
import { insufficient, type AssistantAnswer, type AssistantPlan, type ToolName } from "./types";

type AuthContext = Awaited<ReturnType<typeof requireOrganizationContext>>;
type Client = Awaited<ReturnType<typeof createClient>>;
type Item = OpenItem;
const number = (value: unknown) => Number(value ?? 0);
const reliable = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const money = (value: unknown, currency: string) => new Intl.NumberFormat("en-AE", { style: "currency", currency: currency || "AED", maximumFractionDigits: 2 }).format(number(value));
const link = (label: string, root: string, id?: string) => { const href = safeLink(root, id); return href ? [{ label, href }] : []; };
const base = (toolUsed: ToolName, answer: string, status: AssistantAnswer["status"] = "verified"): AssistantAnswer => ({
  answer, status, toolUsed, facts: [], rows: [], calculation: [], sources: [], actions: [], followUpSuggestions: [], resolvedArgs: {},
});
const scoped = (context: AuthContext) => ({ p_organization_id: context.organization.id, p_branch_id: context.branch.id });
async function dashboard(client: Client, context: AuthContext) {
  const { data, error } = await client.rpc("get_live_dashboard", scoped(context));
  if (error || !data) throw Error("Dashboard data unavailable");
  if (!reliable(data.cash_on_hand) || !reliable(data.cash_at_bank) || !reliable(data.receivables) || !reliable(data.payables)) throw Error("Dashboard amounts incomplete");
  return data as { cash_on_hand: number; cash_at_bank: number; bank_accounts: { name: string; balance: number }[];
    receivables: number; payables: number; receivable_count: number; payable_count: number };
}
async function openItems(client: Client, context: AuthContext, kind: "receivable" | "payable", asOf = dubaiCalendarDate()): Promise<Item[]> {
  const { data, error } = await client.rpc("get_open_item_report", { ...scoped(context), p_kind: kind, p_state: "open", p_as_of: asOf });
  if (error || !data || !Array.isArray(data) || data.length > 2000) throw Error("Open-item report unavailable or exceeds safe limit");
  if (data.some((item) => !reliable(item.outstanding) || !item.party_id || !item.document_id || !item.document_date)) throw Error("Open-item amounts incomplete");
  return (data as Item[]).filter((item) => number(item.outstanding) > 0);
}
async function pnl(client: Client, context: AuthContext, from: string, to: string) {
  const { data, error } = await client.rpc("get_profit_and_loss", { ...scoped(context), p_from: from, p_to: to });
  if (error || !data) throw Error("Profit & Loss unavailable");
  if (![data.revenue, data.cogs, data.expenses, data.netProfit].every(reliable)) throw Error("Profit & Loss amounts incomplete");
  return data as { revenue: number; cogs: number; expenses: number; netProfit: number;
    revenueGroups: { groupName: string; total: number }[]; expenseGroups: { groupName: string; total: number }[] };
}
const priorPeriod = (from: string, to: string) => {
  const span = Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from: new Date(Date.parse(from) - span * 86400000).toISOString().slice(0, 10),
    to: new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10) };
};
async function searchTransactions(client: Client, context: AuthContext, args: Record<string, unknown>): Promise<AssistantAnswer> {
  const specs = [
    { type: "invoice", table: "sales_invoices", date: "invoice_date", amount: "grand_total", number: "invoice_number", party: "customers(name)", root: "/sales/invoices" },
    { type: "bill", table: "purchase_bills", date: "bill_date", amount: "grand_total", number: "bill_number", party: "suppliers(name)", root: "/purchases/bills" },
    { type: "expense", table: "expenses", date: "expense_date", amount: "total_amount", number: "expense_number", party: "payee_name", root: "/expenses" },
    { type: "receipt", table: "customer_receipts", date: "receipt_date", amount: "amount", number: "receipt_number", party: "customers(name)", root: "/sales/customer-payments" },
    { type: "payment", table: "supplier_payments", date: "payment_date", amount: "amount", number: "payment_number", party: "suppliers(name)", root: "/purchases/supplier-payments" },
  ] as const;
  const text = typeof args.text === "string" ? args.text.replace(/[%_\\]/g, "").trim() : "";
  const matches = await Promise.all(specs.filter((s) => !args.type || s.type === args.type || (args.type === "outflow" && ["expense", "payment"].includes(s.type))).map(async (s) => {
    let query = client.from(s.table).select(`id,${s.date},${s.amount},${s.number},reference,${s.party}`)
      .eq("organization_id", context.organization.id).eq("branch_id", context.branch.id).eq("status", "posted")
      .order(s.date, { ascending: false }).limit(200);
    if (args.from) query = query.gte(s.date, String(args.from));
    if (args.to) query = query.lte(s.date, String(args.to));
    if (args.amount) query = query.gte(s.amount, number(args.amount) - 0.005).lte(s.amount, number(args.amount) + 0.005);
    const { data, error } = await query;
    if (error) throw Error("Transaction search unavailable");
    const truncated = (data || []).length === 200;
    const found = (data || []).map((r) => {
      const record = r as Record<string, unknown>;
      const party = s.type === "expense" ? String(record.payee_name || "") :
        (Array.isArray(record[s.type === "invoice" || s.type === "receipt" ? "customers" : "suppliers"])
          ? (record[s.type === "invoice" || s.type === "receipt" ? "customers" : "suppliers"] as { name: string }[])[0]?.name
          : (record[s.type === "invoice" || s.type === "receipt" ? "customers" : "suppliers"] as { name?: string } | null)?.name) || "";
      const reference = String(record.reference || ""), document = String(record[s.number] || "");
      return { type: s.type, label: `${s.type[0].toUpperCase()}${s.type.slice(1)} ${document}`, detail: `${String(record[s.date])} · ${party || "Recorded transaction"}`,
        amount: money(record[s.amount], context.organization.base_currency), href: safeLink(s.root, String(record.id)),
        searchable: `${party} ${reference} ${document}`.toLowerCase(), date: String(record[s.date]), numericAmount: number(record[s.amount]) };
    }).filter((r) => !text || r.searchable.includes(text.toLowerCase()));
    return { found, truncated };
  }));
  if (matches.some((match) => match.truncated)) return insufficient("That search covers more than the safe result window. Narrow it by amount or date so I don't miss a record.", "search_transactions");
  const rows = matches.flatMap((m) => m.found).sort((a, b) => args.sort === "amount_desc" ? b.numericAmount - a.numericAmount : b.date.localeCompare(a.date)).slice(0, number(args.limit || 10));
  const answer = base("search_transactions", rows.length ? `I found ${rows.length} posted transaction${rows.length === 1 ? "" : "s"} matching your filters.${args.type === "outflow" ? " This includes supplier payments and expenses, not every possible cash journal movement." : ""}` : "No posted transactions matched those filters.");
  answer.rows = rows.map(({ label, detail, amount, href }) => ({ label, detail, amount, ...(href ? { href } : {}) }));
  answer.sources = ["Posted FYNTA documents in the selected branch; drafts and voids excluded."];
  answer.followUpSuggestions = ["What happened yesterday?"];
  return answer;
}

async function run(plan: AssistantPlan, client: Client, context: AuthContext): Promise<AssistantAnswer> {
  const a = plan.args, today = dubaiCalendarDate(), currency = context.organization.base_currency;
  let result: AssistantAnswer;
  switch (plan.tool) {
    case "get_unsupported_request": return insufficient(a.reason === "unsafe" ?
      "Assistant V1 cannot run SQL, change records, or access another company or branch. Ask about your selected business instead." :
      a.reason === "unavailable" ? "I don't have enough recorded data to answer that historical question reliably." :
      "I can't reliably interpret that request. Try a specific question about your selected business.", plan.tool);
    case "get_cash_position": {
      const d = await dashboard(client, context);
      result = base(plan.tool, "Your recorded cash and bank position, based on posted journal balances.");
      result.facts = [{ label: "Cash + bank", value: money(number(d.cash_on_hand) + number(d.cash_at_bank), currency) }];
      result.calculation = [{ label: "Cash on hand", value: money(d.cash_on_hand, currency) },
        { label: "Bank accounts", value: money(d.cash_at_bank, currency) }, { label: "Total", value: result.facts[0].value }];
      result.rows = (d.bank_accounts || []).slice(0, 10).map((bank) => ({ label: bank.name, detail: "Posted journal balance", amount: money(bank.balance, currency) }));
      result.sources = ["Live dashboard · posted/reversed journal lines for cash and active bank accounts."];
      result.actions = link("View cash-flow report", "/reports/cash-flow"); result.followUpSuggestions = ["Why is my cash lower?"];
      return result;
    }
    case "get_receivables_summary": case "get_overdue_customers": {
      const items = await openItems(client, context, "receivable", today), current = classifyDue(items, today);
      const overdue = current.overdue.reduce((sum, item) => sum + number(item.outstanding), 0);
      const all = current.total;
      const overdueParties = groupOverdue(items, today, number(a.minimumAmount || 0));
      const balances = new Map<string, { party: string; id: string; amount: number; overdueDays: number }>();
      for (const item of items) { const existing = balances.get(item.party_id), overdueDays =
        (item.due_date || item.document_date) < today ? Math.floor((Date.parse(today) - Date.parse(item.due_date || item.document_date)) / 86400000) : 0;
        balances.set(item.party_id, { party: item.party_name, id: item.party_id, amount: (existing?.amount || 0) + number(item.outstanding),
          overdueDays: Math.max(existing?.overdueDays || 0, overdueDays) }); }
      const parties = plan.tool === "get_overdue_customers" ? overdueParties.map((p) => ({ ...p, overdueDays: p.oldest })) :
        [...balances.values()].sort((x, y) => y.amount - x.amount);
      if (plan.tool === "get_overdue_customers" && a.showInvoices) {
        const selected = parties.slice(0, a.top ? 1 : 10), ids = new Set(selected.map((p) => p.id));
        const invoices = current.overdue.filter((item) => ids.has(item.party_id)).sort((x, y) => number(y.outstanding) - number(x.outstanding));
        result = base(plan.tool, selected.length ? "These are the posted overdue invoices for the selected customer, using remaining open balances." : "No overdue customer matches that filter.");
        result.facts = [{ label: "Selected overdue balance", value: money(selected.reduce((sum, p) => sum + p.amount, 0), currency) }];
        result.rows = invoices.slice(0, 10).map((item) => ({ label: item.document_number, detail: `${item.party_name} · due ${item.due_date || item.document_date}`,
          amount: money(item.outstanding, currency), ...safeLink("/sales/invoices", item.document_id) ? { href: safeLink("/sales/invoices", item.document_id)! } : {} }));
        result.sources = ["Accounts Receivable open-item report · posted overdue invoices and remaining balances in the selected branch."];
        result.actions = link("View receivables", "/reports/accounts-receivable"); return result;
      }
      result = base(plan.tool, plan.tool === "get_overdue_customers" ? "Customers with recorded overdue open balances." : "Here is what customers currently owe, based on unsettled posted open items.");
      result.facts = a.top && plan.tool === "get_overdue_customers" ? [{ label: "Largest overdue customer", value: money(parties[0]?.amount || 0, currency) }] :
        [{ label: "Outstanding", value: money(all, currency) }, { label: "Overdue", value: money(overdue, currency) }];
      result.calculation = a.top && plan.tool === "get_overdue_customers" ? [{ label: "Largest selected overdue balance", value: money(parties[0]?.amount || 0, currency) }] :
        [{ label: "Current open balance", value: money(all - overdue, currency) }, { label: "Overdue open balance", value: money(overdue, currency) }, { label: "Outstanding", value: money(all, currency) }];
      result.rows = parties.slice(0, a.top ? 1 : 10).map((p) => ({ label: p.party, detail: p.overdueDays ? `Oldest item ${p.overdueDays} days overdue` : "Not yet overdue",
        amount: money(p.amount, currency), ...safeLink("/sales/customers", p.id) ? { href: safeLink("/sales/customers", p.id)! } : {} }));
      result.sources = ["Accounts Receivable open-item report · remaining amounts on posted documents, as of today."];
      result.actions = link("View receivables", "/reports/accounts-receivable"); result.followUpSuggestions = ["Only above AED 5,000"];
      return result;
    }
    case "get_payables_summary": case "get_bills_due": {
      const items = await openItems(client, context, "payable", today), all = classifyDue(items, today);
      const due = plan.tool === "get_bills_due" ? classifyDue(items, today, String(a.from), String(a.to), number(a.minimumAmount || 0)) : all;
      const overdue = all.overdue.reduce((sum, item) => sum + number(item.outstanding), 0);
      result = base(plan.tool, plan.tool === "get_bills_due" ? `Bills with remaining balances due ${a.from} to ${a.to}.` : "Your recorded supplier obligations from unsettled posted open items.");
      result.facts = [{ label: plan.tool === "get_bills_due" ? "Due in selected range" : "Outstanding", value: money(due.total, currency) }, { label: "Already overdue", value: money(overdue, currency) }];
      result.rows = [...due.overdue, ...due.current].sort((x, y) => (x.due_date || "").localeCompare(y.due_date || "")).slice(0, 10).map((item) => ({
        label: item.party_name, detail: `${item.document_number} · due ${item.due_date || item.document_date}`, amount: money(item.outstanding, currency),
        ...safeLink("/purchases/bills", item.document_id) ? { href: safeLink("/purchases/bills", item.document_id)! } : {} }));
      result.calculation = [{ label: "Selected remaining open balances", value: money(due.total, currency) }];
      result.sources = ["Accounts Payable open-item report · remaining balances, not original bill totals."];
      result.actions = link("View payables", "/reports/accounts-payable"); result.followUpSuggestions = ["What do I need to pay tomorrow?"];
      return result;
    }
    case "get_sales_summary": case "get_expense_summary": case "get_profit_summary": {
      const p = await pnl(client, context, String(a.from), String(a.to));
      const metric = plan.tool === "get_sales_summary" ? { name: "Revenue", value: p.revenue } : plan.tool === "get_expense_summary" ? { name: "Operating expenses", value: p.expenses } : { name: "Net profit / loss", value: p.netProfit };
      result = base(plan.tool, `${metric.name} for ${a.from} to ${a.to}, from the posted Profit & Loss ledger.`);
      result.facts = [{ label: metric.name, value: money(metric.value, currency) }];
      result.calculation = plan.tool === "get_profit_summary" ? [
        { label: "Revenue", value: money(p.revenue, currency) }, { label: "Cost of sales", value: money(-number(p.cogs), currency) },
        { label: "Operating expenses", value: money(-number(p.expenses), currency) }, { label: "Net profit / loss", value: money(p.netProfit, currency) },
      ] : [{ label: metric.name, value: money(metric.value, currency) }];
      const groups = plan.tool === "get_sales_summary" ? p.revenueGroups : p.expenseGroups;
      result.rows = plan.tool === "get_profit_summary" ? [] : (groups || []).sort((x, y) => number(y.total) - number(x.total)).slice(0, 8)
        .map((g) => ({ label: g.groupName, detail: "Posted ledger account group", amount: money(g.total, currency) }));
      if (a.compare) { const previous = priorPeriod(String(a.from), String(a.to)), other = await pnl(client, context, previous.from, previous.to);
        const previousValue = plan.tool === "get_sales_summary" ? other.revenue : plan.tool === "get_expense_summary" ? other.expenses : other.netProfit;
        result.facts.push({ label: `Previous ${previous.from}–${previous.to}`, value: money(previousValue, currency) });
        result.calculation.push({ label: "Change", value: money(number(metric.value) - number(previousValue), currency) }); }
      result.sources = ["Profit & Loss report · posted/reversed journal lines, selected branch, revenue/COGS/expense account groups."];
      result.actions = link("View Profit & Loss", "/reports/profit-loss"); result.followUpSuggestions = ["Compare this month with last month."];
      return result;
    }
    case "get_vat_estimate": {
      const { data, error } = await client.rpc("get_vat_report", { ...scoped(context), p_from: a.from, p_to: a.to,
        p_transaction_type: null, p_tax_rate_id: null, p_party_type: null, p_party_id: null });
      if (error || !data) throw Error("VAT report unavailable");
      const report = data as { summary: { netOutputVat: number; netInputVat: number; netVatPosition: number };
        reconciliation?: { output?: { difference: number }; input?: { difference: number } } };
      if (!report.summary || ![report.summary.netOutputVat, report.summary.netInputVat, report.summary.netVatPosition].every(reliable)) throw Error("VAT data incomplete");
      result = base(plan.tool, "Estimated VAT position from transactions currently recorded. Missing documents or manual adjustments may change the final amount.", "estimate");
      result.facts = [{ label: "Estimated net VAT position", value: money(report.summary.netVatPosition, currency) }];
      result.calculation = [{ label: "Net output VAT", value: money(report.summary.netOutputVat, currency) },
        { label: "Net input VAT", value: money(-number(report.summary.netInputVat), currency) },
        { label: "Recorded net position", value: money(report.summary.netVatPosition, currency) }];
      result.sources = ["Existing UAE VAT report · posted tax documents, selected branch; estimate, not a filed return."];
      result.actions = link("Review VAT summary and reconciliations", "/reports/vat-summary"); return result;
    }
    case "search_transactions": return searchTransactions(client, context, a);
    case "get_cash_change": {
      const { data, error } = await client.rpc("get_cash_flow_statement", { ...scoped(context), p_from: a.from, p_to: a.to });
      if (error || !data) throw Error("Cash-flow report unavailable");
      const cf = data as { openingCash: number; closingCash: number; operating: number; investing: number; financing: number; unclassified: number; reconciliationDifference: number };
      if (![cf.openingCash, cf.closingCash, cf.operating, cf.investing, cf.financing, cf.unclassified, cf.reconciliationDifference].every(reliable)) throw Error("Cash flow incomplete");
      if (Math.abs(number(cf.reconciliationDifference)) > 0.01) return insufficient("The cash-flow report does not reconcile, so I can't reliably explain the change yet.", plan.tool);
      result = base(plan.tool, `Recorded cash/bank movement ${a.from} to ${a.to}. These are posted movement categories, not inferred causes.`);
      result.facts = [{ label: "Change in cash + bank", value: money(number(cf.closingCash) - number(cf.openingCash), currency) }];
      result.calculation = [{ label: "Opening", value: money(cf.openingCash, currency) }, { label: "Operating", value: money(cf.operating, currency) },
        { label: "Investing", value: money(cf.investing, currency) }, { label: "Financing", value: money(cf.financing, currency) },
        { label: "Unclassified", value: money(cf.unclassified, currency) }, { label: "Closing", value: money(cf.closingCash, currency) }];
      result.sources = ["Existing direct-method Cash Flow report · posted journal cash/bank movements, reconciled opening and closing balances."];
      result.actions = link("View cash flow", "/reports/cash-flow"); return result;
    }
    case "get_business_attention": case "get_business_brief": {
      const [d, receivable, payable] = await Promise.all([dashboard(client, context), openItems(client, context, "receivable", today), openItems(client, context, "payable", today)]);
      const overdueAr = classifyDue(receivable, today).overdue.reduce((sum, i) => sum + number(i.outstanding), 0);
      const overdueAp = classifyDue(payable, today).overdue.reduce((sum, i) => sum + number(i.outstanding), 0);
      const nextWeek = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);
      const upcoming = classifyDue(payable, today, today, nextWeek).total;
      result = base(plan.tool, plan.tool === "get_business_brief" ? "Your recorded business brief from posted accounting data." : "Here are the measurable balances that may need your attention.");
      result.facts = [{ label: "Cash + bank", value: money(number(d.cash_on_hand) + number(d.cash_at_bank), currency) },
        { label: "Overdue receivables", value: money(overdueAr, currency) }, { label: "Overdue payables", value: money(overdueAp, currency) },
        { label: "Bills due next 7 days", value: money(upcoming, currency) }];
      result.sources = ["Live dashboard and posted AR/AP open-item reports in the selected branch."];
      result.actions = [...link("View receivables", "/reports/accounts-receivable"), ...link("View payables", "/reports/accounts-payable")];
      if (plan.tool === "get_business_brief") {
        const p = await pnl(client, context, String(a.from), String(a.to));
        result.facts.push({ label: `Revenue ${a.from}–${a.to}`, value: money(p.revenue, currency) });
        result.facts.push({ label: `Operating expenses ${a.from}–${a.to}`, value: money(p.expenses, currency) });
        result.sources.push("Posted Profit & Loss revenue and operating expense groups; not a cash receipts/payments count.");
      }
      result.followUpSuggestions = ["Who owes me money?", "What bills are due this week?"];
      return result;
    }
  }
}

export async function executeAssistantTool(rawPlan: unknown): Promise<AssistantAnswer> {
  const plan = validatePlan(rawPlan);
  // Membership, selected organization and branch are resolved only from the authenticated session.
  // No model/client organization or branch argument is accepted by the strict registry.
  const context = await requireOrganizationContext();
  const client = await createClient(); // cookie-scoped user client, never service role
  try { const answer = await run(plan, client, context); answer.resolvedArgs = plan.args; return answer; }
  catch { return insufficient("The recorded data for that answer isn't available right now. I won't guess a number.", plan.tool); }
}
