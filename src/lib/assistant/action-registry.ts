import { z } from "zod";
import { documentSchema } from "@/lib/business-document-validation";

export type ActionRisk = "green" | "yellow" | "red";
export type ActionId = "create_invoice_draft" | "create_quotation_draft" | "create_customer" |
  "create_expense_draft" | "create_purchase_bill_draft" | "record_payment";
export type ActionDefinition = {
  id: ActionId;
  label: string;
  risk: ActionRisk;
  status: "available" | "coming_next";
  requiredInputs: readonly string[];
  validation: string;
  preview: boolean;
  execution: string | null;
  permission: string | null;
  destination: string | null;
  confirmationRequired: boolean;
};

export const actionRegistry = {
  create_invoice_draft: { id: "create_invoice_draft", label: "Create Invoice", risk: "yellow", status: "available",
    requiredInputs: ["customer", "items", "invoice date", "due date"], validation: "documentSchema",
    preview: true, execution: "saveBusinessDocument", permission: "sales.create",
    destination: "/sales/invoices", confirmationRequired: true },
  create_quotation_draft: { id: "create_quotation_draft", label: "Create Quotation", risk: "yellow", status: "coming_next",
    requiredInputs: ["customer", "items"], validation: "not_connected", preview: false, execution: null,
    permission: "sales.create", destination: null, confirmationRequired: true },
  create_customer: { id: "create_customer", label: "Add Customer", risk: "yellow", status: "coming_next",
    requiredInputs: ["name"], validation: "not_connected", preview: false, execution: null,
    permission: "masters.manage", destination: null, confirmationRequired: true },
  create_expense_draft: { id: "create_expense_draft", label: "Record Expense", risk: "yellow", status: "coming_next",
    requiredInputs: ["payee", "amount", "account"], validation: "not_connected", preview: false, execution: null,
    permission: "expenses.create", destination: null, confirmationRequired: true },
  create_purchase_bill_draft: { id: "create_purchase_bill_draft", label: "Create Purchase Bill", risk: "yellow", status: "coming_next",
    requiredInputs: ["supplier", "items", "explicit account"], validation: "not_connected", preview: false,
    execution: null, permission: "purchases.create", destination: null, confirmationRequired: true },
  record_payment: { id: "record_payment", label: "Record Payment", risk: "red", status: "coming_next",
    requiredInputs: ["party", "cash/bank", "allocation"], validation: "not_connected", preview: false,
    execution: null, permission: "settlements.create", destination: null, confirmationRequired: true },
} as const satisfies Record<ActionId, ActionDefinition>;

export const activeActionIds = Object.values(actionRegistry).filter((action) => action.status === "available").map((action) => action.id);

/** Future AI output may be validated here, but this registry never executes it. */
export const invoiceActionArgsSchema = documentSchema.omit({ id: true, kind: true, partyId: true, lines: true })
  .extend({ customerId: z.string().uuid(), items: documentSchema.shape.lines }).strict();
export const assistantActionCommandSchema = z.object({
  action: z.literal("create_invoice_draft"),
  args: invoiceActionArgsSchema,
}).strict();
export type InvoiceActionArgs = z.infer<typeof invoiceActionArgsSchema>;

export function validateAssistantActionCommand(value: unknown) {
  return assistantActionCommandSchema.safeParse(value);
}
