import { describe, expect, it } from "vitest";
import type { BusinessDocumentData } from "@/app/actions/business-documents";
import { documentSchema, documentValidationMessage } from "./business-document-validation";
import { newLine, productSelectionPatch, savedLineAccount } from "./business-document-lines";

const supplierId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const otherAccountId = "44444444-4444-4444-8444-444444444444";
const revenueAccountId = "66666666-6666-4666-8666-666666666666";

function data(): BusinessDocumentData {
  return {
    branch: { id: "branch", name: "Branch" },
    customers: [], suppliers: [], locations: [], taxRates: [], summary: [],
    invoices: [], bills: [], invoiceLines: [], billLines: [],
    products: [{ id: productId, name: "Purchase", kind: "service", purchase_price: 25 }],
    accounts: [
      { id: accountId, account_type: "expense", system_key: "rent_expense" },
      { id: otherAccountId, account_type: "asset", system_key: null },
    ],
  };
}

function billLine(account: string) {
  return {
    ...newLine(data(), "bill"),
    accountId: account,
  };
}

function billInput(account: string) {
  const line = billLine(account);
  return {
    kind: "bill" as const,
    partyId: supplierId,
    documentDate: "2026-09-15",
    dueDate: "2026-09-15",
    lines: [{ ...line, taxRateId: undefined, locationId: undefined }],
  };
}

describe("purchase bill account initialization", () => {
  it("starts the first new line empty even when Rent Expense and an asset exist", () => {
    const line = newLine(data(), "bill");
    expect(line.accountId).toBe("");
    expect(line.productId).toBe(productId);
  });

  it("starts each newly added line empty instead of copying an earlier selection", () => {
    const lines = [billLine(accountId)];
    lines.push(newLine(data(), "bill"));
    expect(lines.map((line) => line.accountId)).toEqual([accountId, ""]);
  });

  it("does not select or replace an account when a product is chosen", () => {
    const patch = productSelectionPatch(data(), "bill", productId);
    expect(patch).not.toHaveProperty("accountId");
    expect({ ...newLine(data(), "bill"), ...patch }.accountId).toBe("");
    expect({ ...billLine(otherAccountId), ...patch }.accountId).toBe(otherAccountId);
  });

  it("preserves a saved draft account exactly, including a prior Rent Expense choice", () => {
    expect(savedLineAccount(accountId, data(), "bill")).toBe(accountId);
    expect(savedLineAccount(otherAccountId, data(), "bill")).toBe(otherAccountId);
  });

  it("keeps a missing or null saved draft account empty", () => {
    expect(savedLineAccount(null, data(), "bill")).toBe("");
    expect(savedLineAccount(undefined, data(), "bill")).toBe("");
  });

  it("leaves the existing sales invoice revenue default unchanged", () => {
    const invoiceData = data();
    invoiceData.accounts.push({
      id: revenueAccountId, account_type: "income", system_key: "sales_revenue",
    });
    expect(newLine(invoiceData, "invoice").accountId).toBe(revenueAccountId);
    expect(savedLineAccount(null, invoiceData, "invoice")).toBe(revenueAccountId);
  });

  it("cannot validate a new bill without Account and gives the line-specific error", () => {
    const parsed = documentSchema.safeParse(billInput(""));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(documentValidationMessage("bill", parsed.error.issues))
        .toContain("Line 1: Account is required or invalid.");
    }
  });

  it("accepts an explicitly selected account without changing the line shape", () => {
    const parsed = documentSchema.safeParse(billInput(otherAccountId));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lines[0].accountId).toBe(otherAccountId);
  });
});
