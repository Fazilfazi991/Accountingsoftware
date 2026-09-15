import { z } from "zod";
import type { AssistantPlan, ConversationTurn, ToolName } from "./types";

const date = z.iso.date();
const period = z.object({ from: date, to: date, compare: z.boolean().optional() }).strict()
  .refine((p) => p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) <= 366 * 86400000, "Invalid date range");
const due = z.object({ from: date, to: date, minimumAmount: z.number().finite().min(0).max(1e9).optional() }).strict()
  .refine((p) => p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) <= 366 * 86400000, "Invalid date range");
const search = z.object({ text: z.string().trim().min(2).max(80).optional(), amount: z.number().finite().positive().max(1e9).optional(),
  from: date.optional(), to: date.optional(), type: z.enum(["invoice", "bill", "expense", "receipt", "payment", "outflow"]).optional(),
  limit: z.number().int().min(1).max(20).default(10) }).strict()
  .refine((p) => Boolean(p.text || p.amount || p.from || p.to), "Add a search filter")
  .refine((p) => !p.from || !p.to || (p.from <= p.to && Date.parse(p.to) - Date.parse(p.from) <= 366 * 86400000), "Invalid date range");

export const toolSchemas = {
  get_cash_position: z.object({}).strict(),
  get_receivables_summary: z.object({}).strict(),
  get_overdue_customers: z.object({ minimumAmount: z.number().finite().min(0).max(1e9).optional() }).strict(),
  get_payables_summary: z.object({}).strict(),
  get_bills_due: due,
  get_sales_summary: period,
  get_expense_summary: period,
  get_profit_summary: period,
  search_transactions: search,
  get_vat_estimate: period,
  get_business_attention: z.object({}).strict(),
  get_business_brief: z.object({ from: date, to: date }).strict().refine((p) => p.from <= p.to && Date.parse(p.to) - Date.parse(p.from) <= 31 * 86400000),
  get_cash_change: period,
} as const;

export function validatePlan(value: unknown): AssistantPlan {
  const envelope = z.object({ tool: z.enum(Object.keys(toolSchemas) as [ToolName, ...ToolName[]]), args: z.record(z.string(), z.unknown()) }).strict().parse(value);
  const args = toolSchemas[envelope.tool].parse(envelope.args);
  return { tool: envelope.tool, args: args as Record<string, unknown> };
}

export const requestSchema = z.object({ message: z.string().trim().min(2).max(500),
  turns: z.array(z.object({ question: z.string().max(500), tool: z.enum(Object.keys(toolSchemas) as [ToolName, ...ToolName[]]),
    args: z.record(z.string(), z.unknown()) }).strict()).max(8).optional(),
  context: z.object({ route: z.string().max(120).optional(), entityType: z.string().max(32).optional(), entityId: z.uuid().optional() }).strict().optional(),
}).strict();

export function sanitizeTurns(turns: ConversationTurn[] = []): ConversationTurn[] {
  return turns.slice(-8).flatMap((turn) => { try { const plan = validatePlan({ tool: turn.tool, args: turn.args });
    return [{ question: turn.question.slice(0, 500), ...plan }]; } catch { return []; } });
}

const routeRoots = ["/sales/invoices", "/sales/customer-payments", "/sales/customers", "/purchases/bills",
  "/purchases/supplier-payments", "/purchases/suppliers", "/expenses", "/reports/accounts-receivable",
  "/reports/accounts-payable", "/reports/profit-loss", "/reports/cash-flow", "/reports/vat-summary", "/sales/invoices"];
export function safeLink(root: string, id?: string): string | null {
  if (!routeRoots.includes(root) || (id && !z.uuid().safeParse(id).success)) return null;
  return id ? `${root}/${id}` : root;
}
