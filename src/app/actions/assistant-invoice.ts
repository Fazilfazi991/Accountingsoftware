"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDocumentData, saveBusinessDocument, type BusinessDocumentData } from "./business-documents";
import { validateAssistantActionCommand, type InvoiceActionArgs } from "@/lib/assistant/action-registry";
import { documentValidationMessage } from "@/lib/business-document-validation";

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

export async function saveAssistantInvoiceDraft(command: unknown, expectedBranchId: string): Promise<
  { id: string; label: string; status: "draft" } | { error: string; safeToRetry: boolean }
> {
  const parsed = validateAssistantActionCommand(command);
  if (!parsed.success) return { error: documentValidationMessage("invoice", parsed.error.issues), safeToRetry: true };
  const args = parsed.data.args;
  if (args.dueDate < args.documentDate) return { error: "Due date must not be before invoice date.", safeToRetry: true };
  if (!(await canCreateAssistantInvoice())) return { error: "You do not have permission to create sales invoices.", safeToRetry: true };
  // This is an optimistic guard only; the domain action still derives its actual branch on the server.
  const current = await requireOrganizationContext();
  if (current.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start this draft again.", safeToRetry: true };
  const data = await getAssistantInvoiceData();
  if ("error" in data) return { error: data.error, safeToRetry: true };
  if (data.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start this draft again.", safeToRetry: true };
  const scopedError = scopedReferenceError(args, data);
  if (scopedError) return { error: scopedError, safeToRetry: true };
  const result = await saveBusinessDocument({
    kind: "invoice", partyId: args.customerId, documentDate: args.documentDate, dueDate: args.dueDate,
    reference: args.reference, notes: args.notes,
    lines: args.items.map((line) => ({ ...line, taxRateId: line.taxRateId || undefined,
      locationId: line.locationId || undefined })),
  });
  if ("error" in result) return { error: result.error || "The invoice draft could not be saved.", safeToRetry: false };
  // The Sales Invoice domain only assigns invoice_number on posting. Never claim a draft was numbered.
  return { id: result.id, label: args.reference?.trim() || `Draft ${result.id.slice(0, 8)}`, status: "draft" };
}
