import { describe, expect, it } from "vitest";
import { actionRegistry, activeActionIds, assistantActionCommandSchema, validateAssistantActionCommand } from "./action-registry";

const id = "11111111-1111-4111-8111-111111111111";
const valid = { action: "create_invoice_draft", args: { customerId: id, documentDate: "2026-09-15", dueDate: "2026-09-30",
  items: [{ productId: id, description: "Service", quantity: 2, unitPrice: 100, discount: 0, accountId: id }] } };

describe("Assistant action registry", () => {
  it("exposes exactly three confirmed Yellow actions and defers financial settlement", () => {
    expect(activeActionIds).toEqual(["create_invoice_draft", "create_quotation_draft", "create_customer"]);
    expect(actionRegistry.create_invoice_draft).toMatchObject({ risk: "yellow", confirmationRequired: true,
      preview: true, execution: "saveBusinessDocument", permission: "sales.create", status: "available" });
    expect(actionRegistry.create_quotation_draft).toMatchObject({ risk: "yellow", status: "available",
      permission: "accounting.setup.manage", execution: "saveOperationalDocument", confirmationRequired: true });
    expect(actionRegistry.create_customer).toMatchObject({ risk: "yellow", status: "available",
      permission: "masters.manage", execution: "saveParty", confirmationRequired: true });
    expect(actionRegistry.record_payment).toMatchObject({ risk: "red", execution: null, status: "deferred" });
    expect(actionRegistry.create_expense_draft.status).toBe("coming_next");
    expect(actionRegistry.create_purchase_bill_draft.execution).toBeNull();
  });
  it("validates future structured commands but never exposes an execution command for unsupported actions", () => {
    expect(validateAssistantActionCommand(valid).success).toBe(true);
    expect(validateAssistantActionCommand({ ...valid, action: "record_payment" }).success).toBe(false);
    expect(validateAssistantActionCommand({ ...valid, organizationId: id }).success).toBe(false);
    expect(validateAssistantActionCommand({ ...valid, args: { ...valid.args, branchId: id } }).success).toBe(false);
    expect(validateAssistantActionCommand({ ...valid, args: { ...valid.args, items: [] } }).success).toBe(false);
    expect(validateAssistantActionCommand({ ...valid, args: { ...valid.args, items: [{ ...valid.args.items[0], quantity: 0 }] } }).success).toBe(false);
  });
  it("rejects overrides, posting, allocations and unsupported commands for all active actions", () => {
    const quotation = { action: "create_quotation_draft", args: { customerId: id, date: "2026-09-15",
      expiry: "2026-09-30", lines: [{ productId: id, description: "Service", quantity: 1,
        unitPrice: 10, discount: 0, accountId: id }] } };
    const customer = { action: "create_customer", args: { name: "QA Customer", paymentTermsDays: 30, email: "" } };
    expect(assistantActionCommandSchema.safeParse(quotation).success).toBe(true);
    expect(assistantActionCommandSchema.safeParse(customer).success).toBe(true);
    for (const command of [quotation, customer]) {
      expect(assistantActionCommandSchema.safeParse({ ...command, organizationId: id }).success).toBe(false);
      expect(assistantActionCommandSchema.safeParse({ ...command, args: { ...command.args, branchId: id } }).success).toBe(false);
      expect(assistantActionCommandSchema.safeParse({ ...command, args: { ...command.args, status: "posted" } }).success).toBe(false);
    }
    expect(assistantActionCommandSchema.safeParse({ ...quotation, args: { ...quotation.args, allocations: [] } }).success).toBe(false);
    expect(assistantActionCommandSchema.safeParse({ ...customer, args: { ...customer.args, kind: "supplier" } }).success).toBe(false);
    expect(assistantActionCommandSchema.safeParse({ action: "record_payment", args: {} }).success).toBe(false);
  });
});
