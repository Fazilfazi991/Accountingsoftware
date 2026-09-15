import { describe, expect, it } from "vitest";
import { documentSchema, documentValidationMessage } from "./business-document-validation";

const supplierId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";

function bill() {
  return {
    kind: "bill" as const,
    partyId: supplierId,
    documentDate: "2026-09-15",
    dueDate: "2026-09-15",
    lines: [{
      productId,
      description: "Purchase",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      accountId,
    }],
  };
}

function errorFor(input: ReturnType<typeof bill>) {
  const parsed = documentSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success ? "" : documentValidationMessage("bill", parsed.error.issues);
}

describe("purchase bill validation messages", () => {
  it("keeps zero rate and omitted location valid under the existing schema", () => {
    expect(documentSchema.safeParse(bill()).success).toBe(true);
  });

  it.each([
    ["supplier", (value: ReturnType<typeof bill>) => { value.partyId = ""; }, "Supplier is required or invalid."],
    ["bill date", (value: ReturnType<typeof bill>) => { value.documentDate = ""; }, "Bill date is required or invalid."],
    ["due date", (value: ReturnType<typeof bill>) => { value.dueDate = ""; }, "Due date is required or invalid."],
    ["product", (value: ReturnType<typeof bill>) => { value.lines[0].productId = ""; }, "Line 1: Product is required or invalid."],
    ["quantity", (value: ReturnType<typeof bill>) => { value.lines[0].quantity = 0; }, "Line 1: Quantity must be greater than zero."],
    ["rate", (value: ReturnType<typeof bill>) => { value.lines[0].unitPrice = -1; }, "Line 1: Rate must be zero or greater."],
    ["account", (value: ReturnType<typeof bill>) => { value.lines[0].accountId = ""; }, "Line 1: Account is required or invalid."],
  ])("identifies an invalid %s", (_name, change, message) => {
    const input = bill();
    change(input);
    expect(errorFor(input)).toContain(message);
  });

  it("identifies an omitted rate but still accepts an explicit zero", () => {
    const input = bill();
    const invalid = { ...input, lines: [{ ...input.lines[0], unitPrice: undefined }] };
    const parsed = documentSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(documentValidationMessage("bill", parsed.error.issues)).toContain("Line 1: Rate is required or invalid.");
    }
  });

  it("identifies a malformed stock location without requiring one in the schema", () => {
    const input = bill();
    const invalid = { ...input, lines: [{ ...input.lines[0], locationId: "invalid" }] };
    const parsed = documentSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(documentValidationMessage("bill", parsed.error.issues)).toContain("Line 1: Stock location is invalid.");
    }
  });

  it("preserves the existing generic invoice message", () => {
    const parsed = documentSchema.safeParse({ ...bill(), kind: "invoice", partyId: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(documentValidationMessage("invoice", parsed.error.issues)).toBe("Enter a party, valid dates, and at least one valid line.");
    }
  });
});
