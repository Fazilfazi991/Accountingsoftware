import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireAssistantRequestKey, clearAssistantRequestKey, rotateAssistantRequestKey } from "./client-request-key";

describe("Assistant logical write request key", () => {
  const entries = new Map<string, string>();
  beforeEach(() => {
    entries.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => entries.get(key) || null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("keeps one key across retry/reload but rotates for Create Another", () => {
    const first = acquireAssistantRequestKey("create_invoice_draft", "branch-a");
    expect(acquireAssistantRequestKey("create_invoice_draft", "branch-a")).toBe(first);
    const another = rotateAssistantRequestKey("create_invoice_draft", "branch-a");
    expect(another).not.toBe(first);
    expect(acquireAssistantRequestKey("create_invoice_draft", "branch-a")).toBe(another);
  });
  it("does not share keys across actions or branches", () => {
    const first = acquireAssistantRequestKey("create_invoice_draft", "branch-a");
    expect(acquireAssistantRequestKey("create_quotation_draft", "branch-a")).not.toBe(first);
    expect(acquireAssistantRequestKey("create_invoice_draft", "branch-b")).not.toBe(first);
    clearAssistantRequestKey("create_invoice_draft", "branch-a");
    expect(acquireAssistantRequestKey("create_invoice_draft", "branch-a")).not.toBe(first);
  });
});
