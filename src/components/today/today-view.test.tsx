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
    expect(html).not.toContain("BUSINESS HEALTH");
  });
  it("does not imply an all-good state when open-item sources failed", () => {
    const html = renderToStaticMarkup(<TodayView data={{ ...base, attention: null, warnings: ["Customer due-date details are unavailable."] } as TodayData} />);
    expect(html).toContain("Unable to verify open invoices");
    expect(html).not.toContain("all caught up");
  });
});
