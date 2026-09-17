import { describe, expect, it } from "vitest";
import { paymentLegError } from "./payment-legs";
describe("payment legs", () => {
  it("accepts a cash and bank split that equals the receipt once", () => expect(paymentLegError(5000,[{method:"cash",accountId:"cash",amount:2000},{method:"bank_card",accountId:"bank",amount:3000}])).toBeNull());
  it("supports a partial split receipt", () => expect(paymentLegError(4000,[{method:"cash",accountId:"cash",amount:1000},{method:"bank_card",accountId:"bank",amount:3000}])).toBeNull());
  it("rejects mismatches, zero and negative legs", () => { expect(paymentLegError(5000,[{method:"cash",accountId:"cash",amount:2000}])).toMatch(/add up/); expect(paymentLegError(10,[{method:"cash",accountId:"cash",amount:0}])).toMatch(/greater than zero/); });
});
