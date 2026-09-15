"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDocumentData, type BusinessDocumentData } from "./business-documents";
import { validateAssistantActionCommand, type InvoiceActionArgs } from "@/lib/assistant/action-registry";
import { documentValidationMessage } from "@/lib/business-document-validation";
import { requestKeySchema, assistantWriteError } from "@/lib/assistant/write-request";
import { revalidatePath } from "next/cache";

export type AssistantInvoiceData = Pick<BusinessDocumentData,
  "branch" | "customers" | "products" | "locations" | "accounts" | "taxRates" | "summary">;

export async function canCreateAssistantInvoice(): Promise<boolean> {
  const context = await requireOrganizationContext();
  const client = await createClient();
  const { data, error } = await client.rpc("has_org_capability", {
    p_org: context.organization.id, p_capability: "sales.create",
  });
  return !error && data === true;
}

export async function getAssistantInvoiceData(): Promise<AssistantInvoiceData | { error: string }> {
  if (!(await canCreateAssistantInvoice())) return { error: "You do not have permission to create sales invoices." };
  const result = await getBusinessDocumentData();
  if ("error" in result) return result;
  const { branch, customers, products, locations, accounts, taxRates, summary } = result;
  return { branch, customers, products, locations, accounts, taxRates, summary };
}

function scopedReferenceError(args: InvoiceActionArgs, data: AssistantInvoiceData): string | null {
  if (!data.customers.some((customer) => customer.id === args.customerId))
    return "Choose an active customer in your current company.";
  for (const [index, line] of args.items.entries()) {
    const product = data.products.find((item) => item.id === line.productId);
    if (!product) return `Line ${index + 1}: Choose an active product or service in your company.`;
    if (!data.accounts.some((account) => account.id === line.accountId && account.account_type === "income"))
      return `Line ${index + 1}: Choose an active sales income account.`;
    if (line.taxRateId && !data.taxRates.some((rate) => rate.id === line.taxRateId && rate.sales_enabled))
      return `Line ${index + 1}: Choose an active sales tax rate.`;
    if (product.kind === "product" && product.track_inventory) {
      if (!line.locationId || !data.locations.some((location) => location.id === line.locationId))
        return `Line ${index + 1}: Choose a stock location in the current branch.`;
      const stock = data.summary.filter((row) => row.product_id === line.productId && row.location_id === line.locationId)
        .reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
      if (line.quantity > stock) return `Line ${index + 1}: Quantity exceeds available stock (${stock}).`;
    } else if (line.locationId) return `Line ${index + 1}: Stock location is not applicable to this service.`;
  }
  return null;
}

export async function saveAssistantInvoiceDraft(command: unknown, expectedBranchId: string, requestKey: string): Promise<
  { id: string; label: string; status: "draft" } | { error: string; safeToRetry: boolean }
> {
  const parsed = validateAssistantActionCommand(command);
  if (!parsed.success) return { error: documentValidationMessage("invoice", parsed.error.issues), safeToRetry: true };
  if (!requestKeySchema.safeParse(requestKey).success) return { error: "Invalid write request ID. Start this action again.", safeToRetry: false };
  const args = parsed.data.args;
  if (args.dueDate < args.documentDate) return { error: "Due date must not be before invoice date.", safeToRetry: true };
  if (!(await canCreateAssistantInvoice())) return { error: "You do not have permission to create sales invoices.", safeToRetry: true };
  // This is an optimistic guard only; the domain action still derives its actual branch on the server.
  const current = await requireOrganizationContext();
  if (current.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start this draft again.", safeToRetry: true };
  const client = await createClient();
  const params = { p_org: current.organization.id, p_branch: current.branch.id,
    p_action: "create_invoice_draft", p_request_key: requestKey, p_payload: args };
  const { data: prior, error: lookupError } = await client.rpc("lookup_assistant_write", params);
  if (lookupError) return { error: assistantWriteError(lookupError.message),
    safeToRetry: !lookupError.message.includes("assistant_write_payload_mismatch") &&
      !lookupError.message.includes("assistant_write_scope_mismatch") };
  if (prior) {
    const id = String(prior.id || "");
    if (!requestKeySchema.safeParse(id).success) return { error: "The prior draft result could not be confirmed.", safeToRetry: true };
    return { id, label: args.reference?.trim() || `Draft ${id.slice(0, 8)}`, status: "draft" };
  }
  const data = await getAssistantInvoiceData();
  if ("error" in data) return { error: data.error, safeToRetry: true };
  if (data.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start this draft again.", safeToRetry: true };
  const scopedError = scopedReferenceError(args, data);
  if (scopedError) return { error: scopedError, safeToRetry: true };
  const { data: result, error } = await client.rpc("execute_assistant_write", params);
  if (error) return { error: assistantWriteError(error.message),
    safeToRetry: !error.message.includes("assistant_write_payload_mismatch") &&
      !error.message.includes("assistant_write_scope_mismatch") };
  const id = String(result?.id || "");
  if (!requestKeySchema.safeParse(id).success) return { error: "The draft result could not be confirmed. Retry with the same request ID.", safeToRetry: true };
  revalidatePath("/", "layout");
  // The Sales Invoice domain only assigns invoice_number on posting. Never claim a draft was numbered.
  return { id, label: args.reference?.trim() || `Draft ${id.slice(0, 8)}`, status: "draft" };
}
