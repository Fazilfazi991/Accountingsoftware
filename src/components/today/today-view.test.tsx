import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayView } from "./today-view";
import type { TodayData } from "@/lib/today/data";

const base = { today: "2026-09-15", organization: "QA Company", branch: "Dubai", currency: "AED", timezone: "Asia/Dubai",
  name: "Fazil", status: "Nothing urgent today.", health: { score: 100, label: "Good" },
  money: { now: 1000, coming: 0, going: 0, projected: 1000 }, attention: [],
  activity: { received: 0, spent: 0, invoiced: 0, purchases: 0 }, pulse: null, upcoming: [],
  recommendation: null, nextCollections: 0, hasData: true, warnings: [], horizon: "2026-09-22" } as unknown as TodayData;

describe("Today operating states", () => {
  it("shows an explicit all-good state and no collection call-to-action without overdue items", () => {
    const html = renderToStaticMarkup(<TodayView data={base} />);
    expect(html).toContain("all caught up");
    expect(html).not.toContain("Review invoice →");
    expect(html).toContain("Quick create");
  });
  it("withholds health and shows an onboarding explanation before any posted financial activity", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, hasData: false } as TodayData} />);
    expect(html).toContain("Once you post an invoice");
    expect(html).not.toContain("Business health");
  });
  it("does not imply an all-good state when open-item sources failed", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, attention: null, warnings: ["Customer due-date details are unavailable."] } as TodayData} />);
    expect(html).toContain("Unable to verify open invoices");
    expect(html).not.toContain("all caught up");
  });
  it("preserves cents in displayed QA totals rather than rounding away reconciliation differences", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, pulse: {
      revenue: { current: 18237, previous: 0, difference: 18237, percent: null },
      expenses: { current: 2522.5, previous: 0, difference: 2522.5, percent: null },
      netResult: 15714.5, outstanding: 27281.75, overdue: 27281.75,
      comparison: "2026-09-01–2026-09-15 vs 2026-08-01–2026-08-15",
    } } as TodayData} />);
    expect(html).toContain("2,522.50");
    expect(html).toContain("27,281.75");
  });
  it("keeps the committed attention order and makes the recommendation a separate action", () => {
    const attention = [
      { id: "first", title: "Customer A · overdue collection", detail: "INV-1 · 12 days overdue", amount: 400, rank: 2, href: "/sales/invoices/first", action: "Review & collect" },
      { id: "second", title: "Supplier B · overdue bill", detail: "BILL-2 · 2026-09-01", amount: 200, rank: 1, href: "/purchases/bills/second", action: "Review payments" },
    ];
    const html = renderToStaticMarkup(<TodayView data={{ ...base, name: "ledgerly-qa-user-a", attention,
      recommendation: { ...attention[0], heading: "Collect from Customer A today.", explanation: "Review the open invoice." } } as TodayData} />);
    expect(html.indexOf("/sales/invoices/first")).toBeLessThan(html.indexOf("/purchases/bills/second"));
    expect(html).toContain("Ledgerly recommends");
    expect(html).toContain("Review invoice →");
    expect(html).toContain(", there");
  });
});
