import { describe, expect, it } from "vitest";
import { addDays, comparePeriod, moneyNow, monthPeriods, openItemTotals, todayActivity, type OpenItem } from "./calculations";
import { attentionEngine, businessHealth, collectionRecommendation } from "./rules";

const day = "2026-09-15";
const item = (id: string, due_date: string, outstanding: number, kind: "customer" | "supplier" = "customer"): OpenItem => ({
  open_item_id: id, party_name: kind === "customer" ? "ABC Trading" : "Supply Co",
  document_id: id, document_number: id, due_date, outstanding, item_status: "open",
});

describe("Money now — posted balances plus unsettled open-item due dates", () => {
  it("adds cash and banks without counting documents as cash", () => {
    expect(moneyNow(1000, 2000, 500, 400)).toEqual({ now: 3000, coming: 500, going: 400, projected: 3100 });
  });
  it("counts only open/partial positive invoices due in the next seven days, not overdue, settled or distant", () => {
    const rows = [item("today", day, 200), item("last", addDays(day, 7), 300), item("old", addDays(day, -1), 600),
      item("distant", addDays(day, 8), 800), { ...item("settled", day, 900), item_status: "settled" },
      { ...item("partial", day, 50), item_status: "partial" }];
    expect(openItemTotals(rows, day)).toMatchObject({ next7Amount: 550, overdueAmount: 600, outstanding: 1950 });
    expect(openItemTotals(rows.map((r) => ({ ...r, party_name: "Supplier" })), day).next7Amount).toBe(550);
  });
});

describe("Attention and recommendation", () => {
  it("ranks overdue receivables above overdue and soon-due bills", () => {
    const result = attentionEngine([item("ar", addDays(day, -14), 2000)],
      [item("ap-old", addDays(day, -2), 4000, "supplier"), item("ap-soon", addDays(day, 2), 5000, "supplier")], day);
    expect(result.map((r) => r.id)).toEqual(["ar", "ap-old", "ap-soon"]);
  });
  it("uses overdue age first, then materiality within equal age", () => {
    expect(attentionEngine([item("small", addDays(day, -4), 20), item("large", addDays(day, -4), 700)], [], day).map((r) => r.id))
      .toEqual(["large", "small"]);
  });
  it("does not manufacture alerts in the all-good state", () => {
    expect(attentionEngine([item("future", addDays(day, 4), 100)], [], day)).toEqual([]);
    expect(collectionRecommendation([item("future", addDays(day, 4), 100)], day)).toBeNull();
  });
  it("selects the highest-priority genuinely overdue collection", () => {
    expect(collectionRecommendation([item("recent", addDays(day, -1), 500), item("older", addDays(day, -19), 400)], day)?.id).toBe("older");
  });
  it("uses only measurable health inputs", () => {
    expect(businessHealth([], [], 1000, day)).toEqual({ score: 100, label: "Good" });
    expect(businessHealth([item("old", addDays(day, -31), 20)], [item("bill", addDays(day, 2), 300)], 100, day).score).toBe(55);
  });
});

describe("Today activity", () => {
  it("counts posted receipts as cash once, excludes draft invoices, and includes posted invoices as invoiced only", () => {
    const result = todayActivity([{ date: day, amount: 300, status: "posted" }],
      [{ date: day, amount: 70, status: "posted" }], [{ date: day, amount: 20, status: "posted" }],
      [{ date: day, amount: 800, status: "draft" }, { date: day, amount: 600, status: "posted" }],
      [{ date: day, amount: 400, status: "posted" }], day);
    expect(result).toEqual({ received: 300, spent: 90, invoiced: 600, purchases: 400 });
  });
  it("ignores reversed/different-day documents", () => {
    expect(todayActivity([{ date: day, amount: 10, status: "reversed" }], [], [],
      [{ date: addDays(day, -1), amount: 100, status: "posted" }], [], day)).toEqual({ received: 0, spent: 0, invoiced: 0, purchases: 0 });
  });
});

describe("Pulse periods", () => {
  it("compares equal elapsed days of this month and previous month, including short February", () => {
    expect(monthPeriods("2026-03-31")).toEqual({ currentFrom: "2026-03-01", previousFrom: "2026-02-01", previousTo: "2026-02-28" });
    expect(monthPeriods("2026-01-15")).toEqual({ currentFrom: "2026-01-01", previousFrom: "2025-12-01", previousTo: "2025-12-15" });
  });
  it("handles empty and zero prior periods without a misleading percent", () => {
    expect(comparePeriod(0, 0)).toEqual({ current: 0, previous: 0, difference: 0, percent: null });
    expect(comparePeriod(40, 20).percent).toBe(100);
  });
});
