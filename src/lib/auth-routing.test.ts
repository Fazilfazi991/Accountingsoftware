import { describe, expect, it } from "vitest";
import { safeRedirectPath, safeRequestOrigin } from "./auth-routing";

describe("auth routing", () => {
  it("accepts local paths and rejects off-site redirects", () => {
    expect(safeRedirectPath("/update-password")).toBe("/update-password");
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("https://evil.example")).toBe("/");
  });

  it("accepts HTTPS and local development origins only", () => {
    expect(safeRequestOrigin("https://accountingsoftware-nine.vercel.app/path")).toBe("https://accountingsoftware-nine.vercel.app");
    expect(safeRequestOrigin("http://localhost:3000/login")).toBe("http://localhost:3000");
    expect(safeRequestOrigin("http://evil.example/login")).toBeNull();
  });
});
