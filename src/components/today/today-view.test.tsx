import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "@/app/today/loading";
import Error from "@/app/today/error";
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
    expect(html).toContain("FYNTA recommends");
    expect(html).toContain("Review invoice →");
    expect(html).toContain(", there");
  });
  it("keeps the Dashboard link a practical mobile touch target", () => {
    const css = readFileSync(new URL("./today.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.back\{[^}]*min-height:44px/);
    const html = renderToStaticMarkup(<TodayView data={base} />);
    expect(html).toContain("Dashboard ↗");
    expect(html).not.toContain("QA Company");
    expect(html).not.toContain("Dubai");
  });
  it("offers a forward-looking collection cue in an all-good state", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, nextCollections: 500 } as TodayData} />);
    expect(html).toContain("all caught up");
    expect(html).toContain("AED 500 is due from customers in the next seven days.");
    expect(html).not.toContain("Review invoice →");
  });
  it("withholds unavailable financial values instead of substituting zero", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, money: null, attention: null, activity: null,
      pulse: null, upcoming: null, warnings: ["Customer due-date details are unavailable."] } as TodayData} />);
    expect(html).toContain("Some figures are unavailable.");
    expect(html).toContain("Cash and due-date projection unavailable.");
    expect(html).toContain("Month-to-date ledger figures are unavailable.");
    expect(html).toContain("Same-day posted activity cannot be verified right now.");
    expect(html).not.toContain("Cash now");
  });
  it("keeps the primary posted balance usable when a secondary comparison fails", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, pulse: null,
      warnings: ["Ledger month comparison is unavailable."] } as TodayData} />);
    expect(html).toContain("Cash now");
    expect(html).toContain("AED 1,000");
    expect(html).toContain("Month-to-date ledger figures are unavailable.");
  });
  it("keeps loading and route-error recovery available", () => {
    const loading = renderToStaticMarkup(<Loading />);
    const error = renderToStaticMarkup(<Error reset={() => {}} />);
    expect(loading).toContain('aria-label="Loading Today"');
    expect(error).toContain("Today is temporarily unavailable");
    expect(error).toContain("Try again");
    expect(error).toContain("Return to Dashboard");
  });
});
