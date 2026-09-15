export type ToolName =
  | "get_cash_position" | "get_receivables_summary" | "get_overdue_customers"
  | "get_payables_summary" | "get_bills_due" | "get_sales_summary"
  | "get_expense_summary" | "get_profit_summary" | "search_transactions"
  | "get_vat_estimate" | "get_business_attention" | "get_business_brief"
  | "get_cash_change" | "get_unsupported_request";

export type TrustStatus = "verified" | "estimate" | "insufficient_data";
export type AssistantPlan = { tool: ToolName; args: Record<string, unknown> };
export type ConversationTurn = { question: string; tool: ToolName; args: Record<string, unknown> };
export type AssistantRequest = { message: string; turns?: ConversationTurn[]; context?: { route?: string; entityType?: string; entityId?: string } };
export type AssistantAnswer = {
  answer: string;
  status: TrustStatus;
  toolUsed: ToolName | null;
  facts: { label: string; value: string }[];
  rows: { label: string; detail: string; amount?: string; href?: string }[];
  calculation: { label: string; value: string }[];
  sources: string[];
  actions: { label: string; href: string }[];
  followUpSuggestions: string[];
  resolvedArgs: Record<string, unknown>;
};

export const insufficient = (answer = "I don't have enough recorded data to answer that reliably.", toolUsed: ToolName | null = null): AssistantAnswer => ({
  answer, status: "insufficient_data", toolUsed, facts: [], rows: [], calculation: [],
  sources: [], actions: [], followUpSuggestions: ["What needs my attention today?"], resolvedArgs: {},
});
