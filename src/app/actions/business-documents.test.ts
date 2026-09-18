import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
  requireOrganizationContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/organization-context", () => ({
  requireOrganizationContext: mocks.requireOrganizationContext,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { saveBusinessDocument } from "./business-documents";

const supplierId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const branchId = "44444444-4444-4444-8444-444444444444";
const orgId = "55555555-5555-4555-8555-555555555555";

function bill(account: string) {
  return {
    kind: "bill" as const,
    partyId: supplierId,
    documentDate: "2026-09-15",
    dueDate: "2026-09-15",
    lines: [{
      productId,
      description: "Purchase",
      quantity: 1,
      unitPrice: 25,
      discount: 0,
      accountId: account,
    }],
  };
}

describe("purchase bill save account mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  mocks.requireOrganizationContext.mockResolvedValue({
      organization: { id: orgId }, branch: { id: branchId },
    });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [{ id: accountId, account_type: "expense" }], error: null }),
    });
    mocks.rpc.mockResolvedValue({ data: "bill-id", error: null });
  });

  it("rejects an empty Account before any database call", async () => {
    const result = await saveBusinessDocument(bill(""));
    expect(result).toEqual({ error: "Line 1: Account is required or invalid." });
    expect(mocks.requireOrganizationContext).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the selected UUID in expense_account_id in the existing RPC payload", async () => {
    const result = await saveBusinessDocument(bill(accountId));
    expect(result).toEqual({ id: "bill-id" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_purchase_bill_draft", {
      p_organization_id: orgId,
      p_supplier_id: supplierId,
      p_bill_date: "2026-09-15",
      p_due_date: "2026-09-15",
      p_lines: [{
        description: "Purchase",
        quantity: 1,
        unit_price: 25,
        discount: 0,
        tax_rate_id: null,
        product_id: productId,
        inventory_location_id: null,
        expense_account_id: accountId,
      }],
      p_branch_id: branchId,
      p_reference: null,
      p_notes: null,
    });
  });

  it("rejects a cross-organization or ineligible account before the RPC", async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const result = await saveBusinessDocument(bill(accountId));
    expect(result).toEqual({ error: "Line 1: Account is required or invalid." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("sales invoice save account validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({
      organization: { id: orgId }, branch: { id: branchId },
    });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [{ id: accountId, account_type: "income" }], error: null }),
    });
    mocks.rpc.mockResolvedValue({ data: "invoice-id", error: null });
  });

  const invoice = (account: string) => ({
    kind: "invoice" as const,
    partyId: supplierId,
    documentDate: "2026-09-15",
    dueDate: "2026-09-15",
    lines: [{ productId, description: "Sale", quantity: 1, unitPrice: 25, discount: 0, accountId: account }],
  });

  it("rejects a fresh invoice line without an explicit account", async () => {
    const result = await saveBusinessDocument(invoice(""));
    expect(result).toEqual({ error: "Line 1: Account is required or invalid." });
    expect(mocks.requireOrganizationContext).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps an explicitly selected income account in the invoice RPC payload", async () => {
    const result = await saveBusinessDocument(invoice(accountId));
    expect(result).toEqual({ id: "invoice-id" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_sales_invoice_draft", expect.objectContaining({
      p_lines: [expect.objectContaining({ revenue_account_id: accountId })],
    }));
  });
});
