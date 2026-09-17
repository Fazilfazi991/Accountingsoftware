import { describe, expect, it } from "vitest";
import { filterSearchableOptions } from "./searchable-selector";
const records = [
  { id: "1", label: "Fazil Fahad", description: "050 111 1111 · Dubai" },
  { id: "2", label: "Fazil Mohammed" },
  { id: "3", label: "Fahad Trading LLC", search: "CUST-003" },
  { id: "4", label: "Al Noor Interiors LLC" },
];
describe("searchable selector", () => {
  it("matches case-insensitive partial text across display fields", () => {
    expect(filterSearchableOptions(records, "FA").map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(filterSearchableOptions(records, "fah").map((x) => x.id)).toEqual(["1", "3"]);
    expect(filterSearchableOptions(records, "dubai").map((x) => x.id)).toEqual(["1"]);
  });
  it("bounds results", () => expect(filterSearchableOptions(Array.from({ length: 30 }, (_, i) => ({ id: String(i), label: `Item ${i}` })), "item")).toHaveLength(20));
});
