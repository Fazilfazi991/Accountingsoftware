import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
  getSalesWorkflowData: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./sales-workflow", () => ({ getSalesWorkflowData: mocks.getSalesWorkflowData }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { getAssistantQuotationData, saveAssistantQuotation } from "./assistant-quotation";

const org = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222";
const customer = "33333333-3333-4333-8333-333333333333", product = "44444444-4444-4444-8444-444444444444";
const account = "55555555-5555-4555-8555-555555555555", quote = "66666666-6666-4666-8666-666666666666";
const key = "99999999-9999-4999-8999-999999999999";
const choices = { customers: [{ id: customer, name: "QA Customer" }],
  products: [{ id: product, name: "Service" }], accounts: [{ id: account, account_type: "income" }], taxRates: [] };
const command = { action: "create_quotation_draft", args: { customerId: customer, date: "2026-09-15",
  expiry: "2026-09-30", reference: "QA-V12", lines: [{ productId: product, description: "Service",
    quantity: 2, unitPrice: 10, discount: 0, accountId: account }] } };

describe("Assistant quotation idempotent boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch, name: "QA Branch" } });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: null, error: null } : { data: { id: quote, number: "QT-00001", status: "active" }, error: null });
    mocks.getSalesWorkflowData.mockResolvedValue(choices);
  });
  it("denies choices and writes after permission loss", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantQuotationData()).toHaveProperty("error");
    expect(await saveAssistantQuotation(command, branch, key)).toMatchObject({ safeToRetry: true });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("rejects unsupported fields, branch, customer and request key", async () => {
    expect(await saveAssistantQuotation({ ...command, status: "posted" }, branch, key)).toHaveProperty("error");
    expect(await saveAssistantQuotation(command, org, key)).toHaveProperty("error");
    expect(await saveAssistantQuotation({ ...command, args: { ...command.args, customerId: quote } }, branch, key))
      .toHaveProperty("error");
    expect(await saveAssistantQuotation(command, branch, "bad")).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("replays the native quotation number using the same scoped request", async () => {
    expect(await saveAssistantQuotation(command, branch, key)).toEqual({ id: quote, number: "QT-00001", status: "active" });
    expect(await saveAssistantQuotation(command, branch, key)).toEqual({ id: quote, number: "QT-00001", status: "active" });
    expect(mocks.rpc).toHaveBeenCalledWith("execute_assistant_write", {
      p_org: org, p_branch: branch, p_action: "create_quotation_draft", p_request_key: key,
      p_payload: expect.objectContaining({ customerId: customer, lines: command.args.lines }),
    });
  });
  it("returns an existing quotation after its customer is no longer selectable", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: { id: quote, number: "QT-00001", status: "active" }, error: null } : { data: null, error: null });
    mocks.getSalesWorkflowData.mockResolvedValue({ ...choices, customers: [] });
    expect(await saveAssistantQuotation(command, branch, key)).toEqual({ id: quote, number: "QT-00001", status: "active" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
});
