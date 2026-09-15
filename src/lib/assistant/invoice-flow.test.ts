import { describe, expect, it } from "vitest";
import { emptyInvoiceState, guidedInvoiceReducer as reduce } from "./invoice-flow";

describe("guided invoice state", () => {
  it("requires explicit staged review and locks repeated confirmation", () => {
    let state = reduce(emptyInvoiceState, { type: "begin", today: "2026-09-15", requestId: "request-a" });
    expect(state.stage).toBe("customer");
    state = reduce(state, { type: "next", valid: false }); expect(state.stage).toBe("customer");
    state = reduce(state, { type: "customer", id: "customer-a" });
    state = reduce(state, { type: "next", valid: true }); expect(state.stage).toBe("items");
    state = reduce(state, { type: "next", valid: true }); expect(state.stage).toBe("details");
    state = reduce(state, { type: "next", valid: true }); expect(state.stage).toBe("preview");
    state = reduce(state, { type: "confirm" }); expect(state.stage).toBe("saving");
    expect(reduce(state, { type: "confirm" })).toEqual(state);
    state = reduce(state, { type: "saved", id: "draft-a", number: "Draft draft-a" });
    expect(state.stage).toBe("success");
    expect(reduce(state, { type: "confirm" })).toEqual(state);
  });
  it("cancels without a saved record and treats an ambiguous save as non-retryable", () => {
    let state = reduce(emptyInvoiceState, { type: "begin", today: "2026-09-15", requestId: "request-b" });
    state = reduce(state, { type: "customer", id: "customer-a" });
    expect(reduce(state, { type: "cancel" })).toEqual(emptyInvoiceState);
    state = { ...state, stage: "preview" };
    state = reduce(state, { type: "confirm" });
    state = reduce(state, { type: "uncertain", error: "Check invoices" });
    expect(state.stage).toBe("uncertain");
    expect(reduce(state, { type: "confirm" })).toEqual(state);
  });
  it("starts with the first line atomically when choices have loaded", () => {
    const line = { productId: "", description: "", quantity: 1, unitPrice: 0,
      discount: 0, taxRateId: "", accountId: "", locationId: "" };
    const state = reduce(emptyInvoiceState, { type: "begin", today: "2026-09-15", requestId: "request-c", firstLine: line });
    expect(state.lines).toEqual([line]);
  });
});
