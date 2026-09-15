import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
  getBusinessDocumentData: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./business-documents", () => ({ getBusinessDocumentData: mocks.getBusinessDocumentData }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { getAssistantInvoiceData, saveAssistantInvoiceDraft } from "./assistant-invoice";

const org = "44444444-4444-4444-8444-444444444444";
const branch = "55555555-5555-4555-8555-555555555555";
const customer = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const draft = "66666666-6666-4666-8666-666666666666";
const requestKey = "99999999-9999-4999-8999-999999999999";
const choices = { branch: { id: branch, name: "QA Branch A" }, customers: [{ id: customer, name: "QA Customer" }],
  products: [{ id: product, name: "QA Service", kind: "service", track_inventory: false }], locations: [],
  accounts: [{ id: account, name: "Sales", account_type: "income" }], taxRates: [], summary: [] };
const command = { action: "create_invoice_draft", args: { customerId: customer, documentDate: "2026-09-15",
  dueDate: "2026-09-30", reference: "QA-ASSISTANT-DRAFT", items: [{ productId: product, description: "Service",
    quantity: 2, unitPrice: 100, discount: 0, accountId: account }] } };

describe("Assistant invoice idempotent server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch } });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: null, error: null } : { data: { id: draft, status: "draft" }, error: null });
    mocks.getBusinessDocumentData.mockResolvedValue(choices);
  });
  it("rechecks sales.create before data or write", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantInvoiceData()).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey)).toMatchObject({ safeToRetry: true });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("rejects unsupported action, org override, invalid key, and stale branch", async () => {
    expect(await saveAssistantInvoiceDraft({ ...command, action: "record_payment" }, branch, requestKey)).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft({ ...command, organizationId: org }, branch, requestKey)).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft(command, branch, "not-a-uuid")).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft(command, org, requestKey)).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("sends only validated fields and the same request key to the domain transaction", async () => {
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey))
      .toEqual({ id: draft, label: "QA-ASSISTANT-DRAFT", status: "draft" });
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey))
      .toEqual({ id: draft, label: "QA-ASSISTANT-DRAFT", status: "draft" });
    expect(mocks.rpc).toHaveBeenCalledWith("execute_assistant_write", {
      p_org: org, p_branch: branch, p_action: "create_invoice_draft", p_request_key: requestKey,
      p_payload: expect.objectContaining({ customerId: customer, items: command.args.items }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });
  it("uses a draft ID label when no reference exists", async () => {
    expect(await saveAssistantInvoiceDraft({ ...command, args: { ...command.args, reference: undefined } }, branch, requestKey))
      .toEqual({ id: draft, label: "Draft 66666666", status: "draft" });
  });
  it("returns the same committed draft before mutable choice validation", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: { id: draft, status: "draft" }, error: null } : { data: null, error: null });
    mocks.getBusinessDocumentData.mockResolvedValue({ ...choices, customers: [] });
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey))
      .toEqual({ id: draft, label: "QA-ASSISTANT-DRAFT", status: "draft" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("does not write when references or dates are invalid", async () => {
    expect(await saveAssistantInvoiceDraft({ ...command, args: { ...command.args, customerId: draft } }, branch, requestKey))
      .toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft({ ...command, args: { ...command.args, dueDate: "2026-09-14" } }, branch, requestKey))
      .toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("makes an ambiguous domain/transport response safe to retry with the same key", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: null, error: null } : { data: null, error: { message: "response lost" } });
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey))
      .toEqual({ error: "response lost", safeToRetry: true });
  });
  it("recovers a lost response from the committed same-key result without another write", async () => {
    let committed = false;
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: committed ? { id: draft, status: "draft" } : null, error: null }
        : (committed = true, { data: null, error: { message: "response lost" } }));
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey)).toMatchObject({ safeToRetry: true });
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey))
      .toEqual({ id: draft, label: "QA-ASSISTANT-DRAFT", status: "draft" });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "execute_assistant_write")).toHaveLength(1);
  });
  it("rejects same-key payload mismatch clearly", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : { data: null, error: { message: "assistant_write_payload_mismatch" } });
    expect(await saveAssistantInvoiceDraft(command, branch, requestKey)).toMatchObject({
      error: expect.stringContaining("different details"), safeToRetry: false });
  });
});
