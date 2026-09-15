import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  getSalesWorkflowData: vi.fn(), saveOperationalDocument: vi.fn(),
}));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./sales-workflow", () => ({ getSalesWorkflowData: mocks.getSalesWorkflowData,
  saveOperationalDocument: mocks.saveOperationalDocument }));
import { getAssistantQuotationData, saveAssistantQuotation } from "./assistant-quotation";

const org = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222";
const customer = "33333333-3333-4333-8333-333333333333", product = "44444444-4444-4444-8444-444444444444";
const account = "55555555-5555-4555-8555-555555555555", quote = "66666666-6666-4666-8666-666666666666";
const choices = { customers: [{ id: customer, name: "QA Customer" }],
  products: [{ id: product, name: "Service" }], accounts: [{ id: account, account_type: "income" }], taxRates: [],
  quotations: [], quotationLines: [], deliveryNotes: [], deliveryLines: [], invoices: [], invoiceLines: [],
  conversions: [], page: 1, pageSize: 25, totalCount: 0 };
const command = { action: "create_quotation_draft", args: { customerId: customer, date: "2026-09-15",
  expiry: "2026-09-30", reference: "QA-V11", lines: [{ productId: product, description: "Service",
    quantity: 2, unitPrice: 10, discount: 0, accountId: account }] } };

describe("Assistant Quotation server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch, name: "QA Branch" } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.getSalesWorkflowData.mockResolvedValue(choices);
    mocks.saveOperationalDocument.mockResolvedValue({ id: quote });
    const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: quote, quotation_number: "QT-00001", status: "active" }, error: null }) };
    mocks.from.mockReturnValue(read);
  });
  it("denies quotation choices and writes without the actual normal-domain capability", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantQuotationData()).toHaveProperty("error");
    expect(await saveAssistantQuotation(command, branch)).toMatchObject({ safeToRetry: true });
    expect(mocks.saveOperationalDocument).not.toHaveBeenCalled();
  });
  it("rejects status escalation, a stale branch, and an unsupported customer before the domain write", async () => {
    expect(await saveAssistantQuotation({ ...command, status: "posted" }, branch)).toHaveProperty("error");
    expect(await saveAssistantQuotation(command, org)).toMatchObject({ error: "The selected branch changed. Return to Assistant and start again." });
    expect(await saveAssistantQuotation({ ...command, args: { ...command.args, customerId: quote } }, branch))
      .toMatchObject({ error: "Choose an active customer in your company." });
    expect(mocks.saveOperationalDocument).not.toHaveBeenCalled();
  });
  it("calls the normal quotation domain once and reports its actual official number/status", async () => {
    expect(await saveAssistantQuotation(command, branch)).toEqual({ id: quote, number: "QT-00001", status: "active" });
    expect(mocks.saveOperationalDocument).toHaveBeenCalledTimes(1);
    expect(mocks.saveOperationalDocument).toHaveBeenCalledWith({ kind: "quotation", customerId: customer,
      date: "2026-09-15", expiry: "2026-09-30", reference: "QA-V11", notes: undefined,
      lines: command.args.lines, allocations: [] });
  });
});
