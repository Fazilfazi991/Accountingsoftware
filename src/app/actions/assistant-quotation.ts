"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getSalesWorkflowData, saveOperationalDocument, type SalesWorkflowData } from "./sales-workflow";
import { quotationActionCommandSchema, type QuotationActionArgs } from "@/lib/assistant/action-registry";
import { quotationValidationMessage } from "@/lib/sales-workflow-validation";

export type AssistantQuotationData = Pick<SalesWorkflowData,
  "customers" | "products" | "accounts" | "taxRates"> & { branch: { id: string; name: string } };

export async function canCreateAssistantQuotation(): Promise<boolean> {
  const context = await requireOrganizationContext(), client = await createClient();
  const { data, error } = await client.rpc("has_org_capability", {
    p_org: context.organization.id, p_capability: "accounting.setup.manage",
  });
  return !error && data === true;
}

export async function getAssistantQuotationData(): Promise<AssistantQuotationData | { error: string }> {
  if (!(await canCreateAssistantQuotation())) return { error: "You do not have permission to create quotations." };
  const context = await requireOrganizationContext(), result = await getSalesWorkflowData("quotation");
  if ("error" in result) return result;
  const { customers, products, accounts, taxRates } = result;
  return { branch: { id: context.branch.id, name: context.branch.name }, customers, products, accounts, taxRates };
}

function quotationScopeError(args: QuotationActionArgs, data: AssistantQuotationData): string | null {
  if (!data.customers.some((item) => item.id === args.customerId))
    return "Choose an active customer in your company.";
  for (const [index, line] of args.lines.entries()) {
    if (!data.products.some((item) => item.id === line.productId))
      return `Item ${index + 1}: Choose an active product or service.`;
    if (!data.accounts.some((item) => item.id === line.accountId && item.account_type === "income"))
      return `Item ${index + 1}: Choose an active income account.`;
    if (line.taxRateId && !data.taxRates.some((item) => item.id === line.taxRateId && item.sales_enabled))
      return `Item ${index + 1}: Choose an active sales tax rate.`;
  }
  return null;
}

export async function saveAssistantQuotation(command: unknown, expectedBranchId: string): Promise<
  { id: string; number: string; status: string } | { error: string; safeToRetry: boolean }
> {
  const parsed = quotationActionCommandSchema.safeParse(command);
  if (!parsed.success) return { error: quotationValidationMessage(parsed.error.issues), safeToRetry: true };
  const args = parsed.data.args;
  if (args.expiry < args.date) return { error: "Valid-until date must not be before quotation date.", safeToRetry: true };
  if (!(await canCreateAssistantQuotation())) return { error: "You do not have permission to create quotations.", safeToRetry: true };
  const context = await requireOrganizationContext();
  if (context.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const choices = await getAssistantQuotationData();
  if ("error" in choices) return { error: choices.error, safeToRetry: true };
  if (choices.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const scopedError = quotationScopeError(args, choices);
  if (scopedError) return { error: scopedError, safeToRetry: true };
  // No id, allocations, status, or organization override is accepted from the action command.
  const saved = await saveOperationalDocument({ kind: "quotation", customerId: args.customerId,
    date: args.date, expiry: args.expiry, reference: args.reference, notes: args.notes,
    lines: args.lines, allocations: [] });
  if ("error" in saved) return { error: saved.error || "Quotation result could not be confirmed.", safeToRetry: false };
  const client = await createClient();
  const { data, error } = await client.from("sales_quotations")
    .select("id,quotation_number,status")
    .eq("id", saved.id).eq("organization_id", context.organization.id)
    .eq("branch_id", expectedBranchId).eq("customer_id", args.customerId).maybeSingle();
  if (error || !data) return { error: "Quotation was saved but its result could not be read. Check Quotations before trying again.", safeToRetry: false };
  return { id: data.id, number: data.quotation_number, status: data.status };
}
