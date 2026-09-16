import { describe, expect, it } from "vitest";
import { primaryNavigation } from "./primary-navigation";
import type { NavigationGroup } from "./app-shell";

const groups: readonly NavigationGroup[] = primaryNavigation;

describe("product navigation", () => {
  it("keeps Today as Home, Dashboard as Overview, and Assistant as a direct destination", () => {
    expect(groups.slice(0, 3).map(({ label, href }) => [label, href])).toEqual([
      ["Home", "/"], ["Overview", "/overview"], ["Ask FYNTA", "/assistant"],
    ]);
  });

  it("preserves the existing accounting module destinations", () => {
    const links = groups.flatMap((group) => group.sections?.flatMap((section) => section.items.map(([, href]) => href)) ?? []);
    for (const href of ["/sales/invoices", "/sales/quotations", "/sales/delivery-notes", "/purchases/bills",
      "/expenses", "/reports/profit-loss", "/reports/accounts-receivable", "/reports/accounts-payable"]) {
      expect(links).toContain(href);
    }
  });
});
