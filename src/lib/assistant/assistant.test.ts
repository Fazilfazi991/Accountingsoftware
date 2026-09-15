import { describe, expect, it } from "vitest";
import { DeterministicPlanner } from "./planner";
import { requestSchema, safeLink, sanitizeTurns, validatePlan } from "./registry";
import { cashPosition, classifyDue, groupOverdue, profitBridge, vatPosition, type OpenItem } from "./metrics";
import { insufficient } from "./types";

const planner = new DeterministicPlanner(() => "2026-09-15");
const idA = "11111111-1111-4111-8111-111111111111", idB = "22222222-2222-4222-8222-222222222222";
const item = (party_id: string, due_date: string, outstanding: number, document_id = idA): OpenItem => ({
  open_item_id: idA, party_id, party_name: party_id === idA ? "A" : "B", document_id, document_number: "INV-1",
  due_date, document_date: "2026-08-01", outstanding, age_days: 0,
});
describe("assistant whitelisted plans", () => {
  it("accepts known tool and strict parameters", () => expect(validatePlan({ tool: "get_cash_position", args: {} }).tool).toBe("get_cash_position"));
  it("rejects arbitrary tools and SQL", () => {
    expect(() => validatePlan({ tool: "execute_sql", args: { sql: "select *" } })).toThrow();
    expect(() => validatePlan({ tool: "get_cash_position", args: { sql: "select *" } })).toThrow();
  });
  it("rejects client/model organization and branch overrides", () => {
    expect(() => validatePlan({ tool: "get_cash_position", args: { organizationId: idB } })).toThrow();
    expect(() => validatePlan({ tool: "get_cash_position", args: { branchId: idB } })).toThrow();
    expect(requestSchema.safeParse({ message: "How much cash?", organizationId: idB }).success).toBe(false);
  });
  it("rejects malformed date ranges, excessive pagination and unknown fields", () => {
    expect(() => validatePlan({ tool: "get_bills_due", args: { from: "2026-13-01", to: "2026-09-15" } })).toThrow();
    expect(() => validatePlan({ tool: "get_sales_summary", args: { from: "2026-09-15", to: "2026-01-01" } })).toThrow();
    expect(() => validatePlan({ tool: "search_transactions", args: { amount: 42, limit: 5000 } })).toThrow();
    expect(() => validatePlan({ tool: "get_profit_summary", args: { from: "2026-09-01", to: "2026-09-15", write: true } })).toThrow();
  });
  it("bounds and sanitizes prior turns", () => {
    const turns = Array.from({ length: 10 }, () => ({ question: "Cash", tool: "get_cash_position" as const, args: {} }));
    expect(sanitizeTurns(turns)).toHaveLength(8);
    expect(sanitizeTurns([{ question: "bad", tool: "get_cash_position", args: { org: idB } }])).toEqual([]);
  });
  it("only emits known links with verified UUIDs", () => {
    expect(safeLink("/sales/invoices", idA)).toBe(`/sales/invoices/${idA}`);
    expect(safeLink("https://evil.example", idA)).toBeNull();
    expect(safeLink("/sales/invoices", "../../admin")).toBeNull();
  });
});
describe("follow-up interpretation", () => {
  it("retains overdue customer subject for amount filter", async () => {
    const first = await planner.plan("Show overdue customers", []);
    expect(first.tool).toBe("get_overdue_customers");
    const next = await planner.plan("Only above AED 5,000", [{ question: "Show overdue customers", ...first }]);
    expect(next).toEqual({ tool: "get_overdue_customers", args: { minimumAmount: 5000 } });
  });
  it("keeps the receivables subject through overdue, threshold, largest and invoice follow-ups", async () => {
    const turns: { question: string; tool: Awaited<ReturnType<typeof planner.plan>>["tool"]; args: Record<string, unknown> }[] = [];
    for (const [question, tool] of [["Who owes me money?", "get_receivables_summary"], ["Only show overdue ones.", "get_overdue_customers"],
      ["Only above AED 500.", "get_overdue_customers"], ["Which is the largest?", "get_overdue_customers"],
      ["Show me the invoice.", "get_overdue_customers"]] as const) {
      const plan = await planner.plan(question, turns); expect(plan.tool).toBe(tool);
      turns.push({ question, ...plan });
    }
    expect(turns.at(-1)?.args).toEqual({ minimumAmount: 500, top: true, showInvoices: true });
  });
  it("moves from cash position to cash flow and bounded posted outflow search", async () => {
    const cash = await planner.plan("How much money do I have?", []);
    const flow = await planner.plan("Why is it lower?", [{ question: "Cash", ...cash }]);
    const outflows = await planner.plan("What were the biggest outflows?", [{ question: "Cash", ...cash }, { question: "Why lower", ...flow }]);
    expect(flow.tool).toBe("get_cash_change");
    expect(outflows).toMatchObject({ tool: "search_transactions", args: { type: "outflow", sort: "amount_desc", from: "2026-09-01", to: "2026-09-15" } });
  });
  it("uses last-month period on a sales follow-up", async () => {
    const first = await planner.plan("How much did we sell this month?", []);
    const next = await planner.plan("What about last month?", [{ question: "Sales", ...first }]);
    expect(next.tool).toBe("get_sales_summary"); expect(next.args).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
  });
  it("searches invoices by party and payments by amount", async () => {
    expect(await planner.plan("Show invoices from ABC Trading", [])).toMatchObject({ tool: "search_transactions", args: { type: "invoice", text: "ABC Trading" } });
    expect(await planner.plan("Find AED 4,250 payment to Falcon", [])).toMatchObject({ tool: "search_transactions", args: { amount: 4250, type: "payment", text: "Falcon" } });
    expect(await planner.plan("Show Falcon Supplies transactions", [])).toMatchObject({ tool: "search_transactions", args: { text: "Falcon Supplies" } });
    expect(await planner.plan("What did I pay yesterday?", [])).toMatchObject({ tool: "search_transactions", args: { type: "outflow", from: "2026-09-14", to: "2026-09-14" } });
    expect(await planner.plan("What payments were recorded today?", [])).toMatchObject({ tool: "search_transactions", args: { type: "payment", from: "2026-09-15", to: "2026-09-15" } });
    expect(await planner.plan("Who owes me money?", [])).toMatchObject({ tool: "get_receivables_summary" });
  });
  it("refuses unsafe, historical and unrecognized questions without querying attention data", async () => {
    expect(await planner.plan("Run SQL select * from invoices", [])).toEqual({ tool: "get_unsupported_request", args: { reason: "unsafe" } });
    expect(await planner.plan("Show another company revenue", [])).toEqual({ tool: "get_unsupported_request", args: { reason: "unsafe" } });
    expect(await planner.plan("What was my exact cash balance on 2024-01-01?", [])).toEqual({ tool: "get_unsupported_request", args: { reason: "unavailable" } });
    expect(await planner.plan("What payments were recorded on 2026-13-01?", [])).toEqual({ tool: "get_unsupported_request", args: { reason: "unrecognized" } });
    expect(await planner.plan("What is the weather?", [])).toEqual({ tool: "get_unsupported_request", args: { reason: "unrecognized" } });
  });
});
describe("deterministic accounting arithmetic", () => {
  it("uses remaining open balances, not invoice original amount", () => {
    const items = [item(idA, "2026-09-01", 2500), item(idA, "2026-09-20", 1500), item(idB, "2026-09-10", 6000)];
    expect(classifyDue(items, "2026-09-15").total).toBe(10000);
    expect(classifyDue(items, "2026-09-15").overdue.reduce((sum, i) => sum + i.outstanding, 0)).toBe(8500);
    expect(groupOverdue(items, "2026-09-15", 5000)).toEqual([{ party: "B", id: idB, amount: 6000, oldest: 5 }]);
    expect(groupOverdue(items, "2026-09-15", 6000)).toEqual([]); // "above" excludes the exact boundary
  });
  it("separates overdue, due-soon and amount-filtered bills", () => {
    const items = [item(idA, "2026-09-10", 100), item(idA, "2026-09-16", 800), item(idB, "2026-09-25", 2000)];
    expect(classifyDue(items, "2026-09-15", "2026-09-15", "2026-09-22").total).toBe(800);
    expect(classifyDue(items, "2026-09-15").overdue).toHaveLength(1);
    expect(classifyDue(items, "2026-09-15", "2026-09-15", "2026-09-30", 1000).total).toBe(2000);
  });
  it("cash excludes unposted document totals by taking only ledger inputs", () => expect(cashPosition(250, 500)).toBe(750));
  it("profit and VAT bridges use report components", () => {
    expect(profitBridge(1000, 400, 300)).toBe(300);
    expect(vatPosition(250, 90)).toBe(160);
  });
  it("refuses to invent missing facts", () => {
    const answer = insufficient(); expect(answer.status).toBe("insufficient_data"); expect(answer.facts).toEqual([]);
  });
});
