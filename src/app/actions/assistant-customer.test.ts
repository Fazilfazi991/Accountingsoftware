import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
  getParties: vi.fn(), saveParty: vi.fn() }));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./controls", () => ({ getParties: mocks.getParties, saveParty: mocks.saveParty }));
import { getAssistantCustomerData, saveAssistantCustomer } from "./assistant-customer";

const org = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const command = { action: "create_customer", args: { name: "QA Customer", email: "", phone: "",
  trn: "", address: "", paymentTermsDays: 30 } };

describe("Assistant Customer server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch, name: "QA Branch" } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.getParties.mockResolvedValue({ rows: [] });
    mocks.saveParty.mockResolvedValue({ ok: true, id });
  });
  it("denies choices and writes without masters.manage", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantCustomerData()).toHaveProperty("error");
    expect(await saveAssistantCustomer(command, branch, false)).toMatchObject({ safeToRetry: true });
    expect(mocks.saveParty).not.toHaveBeenCalled();
  });
  it("rejects client status/id/org overrides and a stale branch", async () => {
    expect(await saveAssistantCustomer({ ...command, args: { ...command.args, active: false } }, branch, false)).toHaveProperty("error");
    expect(await saveAssistantCustomer({ ...command, organizationId: org }, branch, false)).toHaveProperty("error");
    expect(await saveAssistantCustomer(command, org, false)).toMatchObject({ error: "The selected branch changed. Return to Assistant and start again." });
    expect(mocks.saveParty).not.toHaveBeenCalled();
  });
  it("warns about likely duplicates, then permits explicit Continue Anyway through the normal domain", async () => {
    mocks.getParties.mockResolvedValue({ rows: [{ id, name: "qa  customer", is_active: true }] });
    expect(await saveAssistantCustomer(command, branch, false)).toMatchObject({ duplicateWarning: [{ id, reasons: ["name"] }] });
    expect(mocks.saveParty).not.toHaveBeenCalled();
    expect(await saveAssistantCustomer(command, branch, true)).toEqual({ id, name: "QA Customer", email: "", phone: "", trn: "" });
    expect(mocks.saveParty).toHaveBeenCalledWith({ kind: "customer", name: "QA Customer", email: "",
      phone: "", trn: "", address: "", paymentTermsDays: 30, active: true });
  });
  it("never writes an exact duplicate name, even after Continue Anyway", async () => {
    mocks.getParties.mockResolvedValue({ rows: [{ id, name: "QA Customer", is_active: true }] });
    expect(await saveAssistantCustomer(command, branch, true)).toMatchObject({ safeToRetry: true,
      error: "That exact customer name already exists. Edit the name or use the existing customer." });
    expect(mocks.saveParty).not.toHaveBeenCalled();
  });
});
