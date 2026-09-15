import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
  getParties: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./controls", () => ({ getParties: mocks.getParties }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { getAssistantCustomerData, saveAssistantCustomer } from "./assistant-customer";

const org = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333", key = "99999999-9999-4999-8999-999999999999";
const command = { action: "create_customer", args: { name: "QA Customer", email: "", phone: "",
  trn: "", address: "", paymentTermsDays: 30 } };

describe("Assistant customer idempotent boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch, name: "QA Branch" } });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: null, error: null } : { data: { id, name: "QA Customer", email: "", phone: "", trn: "" }, error: null });
    mocks.getParties.mockResolvedValue({ rows: [] });
  });
  it("denies choices and replay after masters.manage is revoked", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantCustomerData()).toHaveProperty("error");
    expect(await saveAssistantCustomer(command, branch, false, key)).toMatchObject({ safeToRetry: true });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("rejects client id/status/org overrides and a stale branch", async () => {
    expect(await saveAssistantCustomer({ ...command, args: { ...command.args, active: false } }, branch, false, key))
      .toHaveProperty("error");
    expect(await saveAssistantCustomer({ ...command, organizationId: org }, branch, false, key)).toHaveProperty("error");
    expect(await saveAssistantCustomer(command, org, false, key)).toHaveProperty("error");
    expect(await saveAssistantCustomer(command, branch, false, "bad-key")).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("replays the original customer even when it now appears among duplicate candidates", async () => {
    expect(await saveAssistantCustomer(command, branch, true, key))
      .toEqual({ id, name: "QA Customer", email: "", phone: "", trn: "" });
    mocks.getParties.mockResolvedValue({ rows: [{ id, name: "QA Customer", is_active: true }] });
    expect(await saveAssistantCustomer(command, branch, true, key))
      .toEqual({ id, name: "QA Customer", email: "", phone: "", trn: "" });
    expect(mocks.rpc).toHaveBeenCalledWith("execute_assistant_write", {
      p_org: org, p_branch: branch, p_action: "create_customer", p_request_key: key,
      p_payload: expect.objectContaining({ name: "QA Customer" }),
    });
  });
  it("returns a committed customer even if the advisory data read later fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: { id, name: "QA Customer", email: "", phone: "", trn: "" }, error: null }
        : { data: null, error: null });
    mocks.getParties.mockResolvedValue({ error: "offline" });
    expect(await saveAssistantCustomer(command, branch, true, key))
      .toEqual({ id, name: "QA Customer", email: "", phone: "", trn: "" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("execute_assistant_write", expect.anything());
  });
  it("surfaces the transaction's exact-name and payload mismatch errors", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : name === "lookup_assistant_write"
        ? { data: null, error: null } : { data: null, error: { message: "assistant_customer_name_exists" } });
    expect(await saveAssistantCustomer(command, branch, true, key)).toMatchObject({
      error: expect.stringContaining("exact customer name") });
    mocks.rpc.mockImplementation(async (name: string) => name === "has_org_capability"
      ? { data: true, error: null } : { data: null, error: { message: "assistant_write_payload_mismatch" } });
    expect(await saveAssistantCustomer(command, branch, true, key)).toMatchObject({
      safeToRetry: false, error: expect.stringContaining("different details") });
  });
});
