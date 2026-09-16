import { afterEach, describe, expect, it, vi } from "vitest";
import { CompatibleProviderPlanner, ProviderUnavailableError } from "./planner";

const original = {
  provider: process.env.LEDGERLY_AI_PROVIDER,
  model: process.env.LEDGERLY_AI_MODEL,
  baseUrl: process.env.LEDGERLY_AI_BASE_URL,
  key: process.env.LEDGERLY_AI_API_KEY,
};

afterEach(() => {
  Object.assign(process.env, {
    LEDGERLY_AI_PROVIDER: original.provider,
    LEDGERLY_AI_MODEL: original.model,
    LEDGERLY_AI_BASE_URL: original.baseUrl,
    LEDGERLY_AI_API_KEY: original.key,
  });
  vi.restoreAllMocks();
});

describe("DeepSeek-compatible planner", () => {
  it("accepts only a validated tool envelope from the provider", async () => {
    process.env.LEDGERLY_AI_MODEL = "deepseek-flash";
    process.env.LEDGERLY_AI_BASE_URL = "https://api.deepseek.com";
    process.env.LEDGERLY_AI_API_KEY = "test-only-not-a-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tool: "get_cash_position", args: {} }) } }],
    }), { status: 200 })));
    await expect(new CompatibleProviderPlanner().plan("How much money do I have?", [])).resolves.toEqual({ tool: "get_cash_position", args: {} });
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toContain('"response_format":{"type":"json_object"}');
  });

  it("surfaces provider failure instead of silently claiming a deterministic answer", async () => {
    process.env.LEDGERLY_AI_MODEL = "deepseek-flash";
    process.env.LEDGERLY_AI_BASE_URL = "https://api.deepseek.com";
    process.env.LEDGERLY_AI_API_KEY = "test-only-not-a-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream failure", { status: 503 })));
    await expect(new CompatibleProviderPlanner().plan("Who owes me?", [])).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
