import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  getBusinessDocumentData: vi.fn(), saveBusinessDocument: vi.fn(),
}));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./business-documents", () => ({ getBusinessDocumentData: mocks.getBusinessDocumentData,
  saveBusinessDocument: mocks.saveBusinessDocument }));

import { getAssistantInvoiceData, recoverAssistantInvoiceDraft, saveAssistantInvoiceDraft } from "./assistant-invoice";

const customer = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const org = "44444444-4444-4444-8444-444444444444";
const branch = "55555555-5555-4555-8555-555555555555";
const draft = "66666666-6666-4666-8666-666666666666";
const stockLocation = "77777777-7777-4777-8777-777777777777";
const otherLocation = "88888888-8888-4888-8888-888888888888";
const choices = { branch: { id: branch, name: "QA Branch A" }, customers: [{ id: customer, name: "QA Customer" }],
  products: [{ id: product, name: "QA Service", kind: "service", track_inventory: false }], locations: [],
  accounts: [{ id: account, name: "Sales", account_type: "income" }], taxRates: [], summary: [],
  suppliers: [], invoices: [], bills: [], invoiceLines: [], billLines: [] };
const command = { action: "create_invoice_draft", args: { customerId: customer, documentDate: "2026-09-15",
  dueDate: "2026-09-30", reference: "QA-ASSISTANT-DRAFT", items: [{ productId: product, description: "Service",
    quantity: 2, unitPrice: 100, discount: 0, accountId: account }] } };

describe("Assistant invoice server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue({ organization: { id: org }, branch: { id: branch }, user: { id: customer } });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.getBusinessDocumentData.mockResolvedValue(choices);
    mocks.saveBusinessDocument.mockResolvedValue({ id: draft });
  });
  it("does not expose invoice choices or execute a save without sales.create", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await getAssistantInvoiceData()).toEqual({ error: "You do not have permission to create sales invoices." });
    expect(await saveAssistantInvoiceDraft(command, branch)).toMatchObject({ error: "You do not have permission to create sales invoices.", safeToRetry: true });
    expect(mocks.getBusinessDocumentData).not.toHaveBeenCalled();
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
  it("rejects unsupported action, client organization and mismatched customer before the domain save", async () => {
    expect(await saveAssistantInvoiceDraft({ ...command, action: "record_payment" }, branch)).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft({ ...command, organizationId: org }, branch)).toHaveProperty("error");
    expect(await saveAssistantInvoiceDraft({ ...command, args: { ...command.args, customerId: draft } }, branch)).toMatchObject({
      error: "Choose an active customer in your current company.", safeToRetry: true });
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
  it("rejects a stale preview after the selected branch changes", async () => {
    expect(await saveAssistantInvoiceDraft(command, otherLocation)).toMatchObject({
      error: "The selected branch changed. Return to Assistant and start this draft again.", safeToRetry: true });
    expect(mocks.getBusinessDocumentData).not.toHaveBeenCalled();
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
  it("passes only validated invoice fields into the existing draft domain action", async () => {
    expect(await saveAssistantInvoiceDraft(command, branch)).toEqual({ id: draft, label: "QA-ASSISTANT-DRAFT", status: "draft" });
    expect(mocks.rpc).toHaveBeenCalledWith("has_org_capability", { p_org: org, p_capability: "sales.create" });
    expect(mocks.saveBusinessDocument).toHaveBeenCalledWith({ kind: "invoice", partyId: customer,
      documentDate: "2026-09-15", dueDate: "2026-09-30", reference: "QA-ASSISTANT-DRAFT", notes: undefined,
      lines: [{ productId: product, description: "Service", quantity: 2, unitPrice: 100, discount: 0,
        accountId: account, taxRateId: undefined, locationId: undefined }] });
  });
  it("uses a short draft ID when no reference was supplied", async () => {
    const withoutReference = { ...command, args: { ...command.args, reference: undefined } };
    expect(await saveAssistantInvoiceDraft(withoutReference, branch)).toEqual({ id: draft, label: "Draft 66666666", status: "draft" });
  });
  it("rejects invalid dates and a tracked line outside current-branch stock before saving", async () => {
    expect(await saveAssistantInvoiceDraft({ ...command, args: { ...command.args, dueDate: "2026-09-14" } }, branch)).toMatchObject({
      error: "Due date must not be before invoice date.", safeToRetry: true });
    mocks.getBusinessDocumentData.mockResolvedValue({ ...choices,
      products: [{ id: product, name: "QA Product", kind: "product", track_inventory: true }],
      locations: [{ id: stockLocation, name: "Current branch" }],
      summary: [{ product_id: product, location_id: stockLocation, quantity_on_hand: 1 }],
    });
    const tracked = { ...command, args: { ...command.args,
      items: [{ ...command.args.items[0], locationId: otherLocation }] } };
    expect(await saveAssistantInvoiceDraft(tracked, branch)).toMatchObject({
      error: "Line 1: Choose a stock location in the current branch.", safeToRetry: true });
    expect(await saveAssistantInvoiceDraft({ ...tracked, args: { ...tracked.args,
      items: [{ ...tracked.args.items[0], locationId: stockLocation }] } }, branch)).toMatchObject({
      error: "Line 1: Quantity exceeds available stock (1).", safeToRetry: true });
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
  it("marks a domain/transport failure as uncertain rather than inviting a duplicate retry", async () => {
    mocks.saveBusinessDocument.mockResolvedValue({ error: "The draft could not be saved." });
    expect(await saveAssistantInvoiceDraft(command, branch)).toEqual({ error: "The draft could not be saved.", safeToRetry: false });
  });
  it("recovers an exact recent draft after a lost success response without creating again", async () => {
    const invoiceQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: draft, reference: "QA-ASSISTANT-DRAFT", notes: null }], error: null }) };
    const linesQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [{ invoice_id: draft, product_id: product, description: "Service",
        quantity: "2.000000", unit_price: "100.000000", discount: "0.000000", revenue_account_id: account,
        tax_rate_id: null, inventory_location_id: null }], error: null }) };
    mocks.from.mockImplementation((table: string) => table === "sales_invoices" ? invoiceQuery : linesQuery);
    expect(await recoverAssistantInvoiceDraft(command, branch, new Date().toISOString()))
      .toEqual({ status: "found", id: draft, label: "QA-ASSISTANT-DRAFT" });
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
  it("does not declare an empty recovery read safe to retry, since the write may still be in flight", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await recoverAssistantInvoiceDraft(command, branch, new Date().toISOString()))
      .toEqual({ status: "unknown" });
    expect(mocks.saveBusinessDocument).not.toHaveBeenCalled();
  });
});
