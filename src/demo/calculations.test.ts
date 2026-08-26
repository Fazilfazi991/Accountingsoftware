import { describe, expect, it } from "vitest";
import { calculateInvoice, convertQuotationToInvoice, eligibleCredit, journalDifference, mutateStock, paymentStatus, reconciliationMatch, reconciliationUnmatch, statementBalances, vatPercent, vatPosition } from "./calculations";

describe("demo accounting calculations", () => {
  it("calculates discounted standard-rated invoice totals", () => {
    expect(calculateInvoice([{ quantity: 2, rate: 100, discount: 20, vatRate: "standard" }], 50)).toMatchObject({ subtotal: 200, discount: 20, taxable: 180, vat: 9, total: 189, balance: 139 });
  });
  it("applies zero VAT to non-standard categories", () => expect(vatPercent("zero")).toBe(0));
  it("sets payment status from allocated amount", () => { expect(paymentStatus(100, 0)).toBe("Posted"); expect(paymentStatus(100, 40)).toBe("Partially Paid"); expect(paymentStatus(100, 100)).toBe("Paid"); });
  it("requires balanced journal lines", () => expect(journalDifference([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBe(0));
  it("converts a quotation without re-entering its lines", () => expect(convertQuotationToInvoice({ customerId:"a", date:"2026-07-23", lines:[{quantity:1,rate:50,vatRate:"zero"}] })).toMatchObject({customerId:"a",status:"Draft",amountPaid:0}));
  it("caps a credit note at the eligible outstanding value", () => expect(eligibleCredit(90, 120)).toBe(90));
  it("updates stock quantities for purchases and sales", () => { expect(mutateStock(10,"purchase",5)).toBe(15); expect(mutateStock(10,"sale",5)).toBe(5); });
  it("calculates input/output VAT position", () => expect(vatPosition(50, 30)).toBe(20));
  it("matches a statement transaction to its Ledgerly transaction", () => expect(reconciliationMatch([{id:"statement-1",matchedTo:""}], "statement-1", "ledger-1")[0].matchedTo).toBe("ledger-1"));
  it("unmatches a statement transaction", () => expect(reconciliationUnmatch([{id:"statement-1",matchedTo:"ledger-1"}], "statement-1")[0].matchedTo).toBeUndefined());
  it("caps a purchase debit note at the eligible payable", () => expect(eligibleCredit(250, 275)).toBe(250));
  it("calculates customer statement running balances", () => expect(statementBalances([{debit:100,credit:0},{debit:0,credit:40},{debit:50,credit:0}])).toEqual([100,60,110]));
  it("calculates supplier statement running balances", () => expect(statementBalances([{debit:500,credit:0},{debit:0,credit:125},{debit:0,credit:75}])).toEqual([500,375,300]));
});
