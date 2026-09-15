import { describe, expect, it } from "vitest";
import { actionRegistry, activeActionIds, validateAssistantActionCommand } from "./action-registry";

const id = "11111111-1111-4111-8111-111111111111";
const valid = { action: "create_invoice_draft", args: { customerId: id, documentDate: "2026-09-15", dueDate: "2026-09-30",
  items: [{ productId: id, description: "Service", quantity: 2, unitPrice: 100, discount: 0, accountId: id }] } };

describe("Assistant action registry", () => {
  it("exposes only the confirmed invoice action", () => {
    expect(activeActionIds).toEqual(["create_invoice_draft"]);
    expect(actionRegistry.create_invoice_draft).toMatchObject({ risk: "yellow", confirmationRequired: true,
      preview: true, execution: "saveBusinessDocument", permission: "sales.create", status: "available" });
    expect(actionRegistry.record_payment).toMatchObject({ risk: "red", execution: null, status: "coming_next" });
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
});
