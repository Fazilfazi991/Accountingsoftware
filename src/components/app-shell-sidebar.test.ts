import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("src/components/app-shell.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("FYNTA sidebar branding", () => {
  it("does not render tenant or branch identity below the logo", () => {
    const sidebar = shell.slice(shell.indexOf("export function Sidebar"), shell.indexOf("export function AppShell"));
    expect(sidebar).not.toContain("OrganizationIdentity");
    expect(sidebar).toContain('<BrandLogo variant="dark"');
  });
  it("centers the wordmark while preserving the collapsed mark", () => {
    expect(css).toContain("justify-content: center; border-bottom");
    expect(shell).toContain("brand-collapsed-mark");
    expect(shell).toContain("<OrganizationSwitcher />");
  });
});
