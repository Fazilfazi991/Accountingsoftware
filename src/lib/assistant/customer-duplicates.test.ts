import { describe, expect, it } from "vitest";
import { likelyCustomerDuplicates } from "./customer-duplicates";

describe("advisory customer duplicate check", () => {
  it("normalizes name, email, phone and TRN without blocking non-matches", () => {
    const matches = likelyCustomerDuplicates({ name: "  Acme   LLC ", email: "A@EXAMPLE.COM",
      phone: "+971 50 123 4567", trn: " 123 456 " }, [
      { id: "customer-a", name: "acme llc", email: "a@example.com", phone: "971501234567", trn: "123456", is_active: true },
      { id: "customer-b", name: "Other", email: "", phone: "", trn: "", is_active: false },
    ]);
    expect(matches).toEqual([{ id: "customer-a", name: "acme llc", active: true,
      reasons: ["name", "email", "phone", "TRN"] }]);
  });
});
