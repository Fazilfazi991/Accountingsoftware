"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getSalesWorkflowData, type SalesWorkflowData } from "./sales-workflow";
import { quotationActionCommandSchema, type QuotationActionArgs } from "@/lib/assistant/action-registry";
import { quotationValidationMessage } from "@/lib/sales-workflow-validation";
import { requestKeySchema, assistantWriteError } from "@/lib/assistant/write-request";
import { revalidatePath } from "next/cache";

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

export async function saveAssistantQuotation(command: unknown, expectedBranchId: string, requestKey: string): Promise<
  { id: string; number: string; status: string } | { error: string; safeToRetry: boolean }
> {
  const parsed = quotationActionCommandSchema.safeParse(command);
  if (!parsed.success) return { error: quotationValidationMessage(parsed.error.issues), safeToRetry: true };
  if (!requestKeySchema.safeParse(requestKey).success) return { error: "Invalid write request ID. Start this action again.", safeToRetry: false };
  const args = parsed.data.args;
  if (args.expiry < args.date) return { error: "Valid-until date must not be before quotation date.", safeToRetry: true };
  if (!(await canCreateAssistantQuotation())) return { error: "You do not have permission to create quotations.", safeToRetry: true };
  const context = await requireOrganizationContext();
  if (context.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const client = await createClient();
  const params = { p_org: context.organization.id, p_branch: context.branch.id,
    p_action: "create_quotation_draft", p_request_key: requestKey, p_payload: args };
  const { data: prior, error: lookupError } = await client.rpc("lookup_assistant_write", params);
  if (lookupError) return { error: assistantWriteError(lookupError.message),
    safeToRetry: !lookupError.message.includes("assistant_write_payload_mismatch") &&
      !lookupError.message.includes("assistant_write_scope_mismatch") };
  if (prior) {
    if (!requestKeySchema.safeParse(prior.id).success || typeof prior.number !== "string")
      return { error: "The prior quotation result could not be confirmed.", safeToRetry: true };
    return { id: prior.id, number: prior.number, status: prior.status };
  }
  const choices = await getAssistantQuotationData();
  if ("error" in choices) return { error: choices.error, safeToRetry: true };
  if (choices.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const scopedError = quotationScopeError(args, choices);
  if (scopedError) return { error: scopedError, safeToRetry: true };
  // The transaction wrapper invokes save_operational_document, the same RPC as the normal form.
  const { data, error } = await client.rpc("execute_assistant_write", params);
  if (error) return { error: assistantWriteError(error.message),
    safeToRetry: !error.message.includes("assistant_write_payload_mismatch") &&
      !error.message.includes("assistant_write_scope_mismatch") };
  if (!requestKeySchema.safeParse(data?.id).success || typeof data?.number !== "string")
    return { error: "The quotation result could not be confirmed. Retry with the same request ID.", safeToRetry: true };
  revalidatePath("/", "layout");
  return { id: data.id, number: data.number, status: data.status };
}
