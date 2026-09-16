import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";

const requestSchema = z.object({
  message: z.string().trim().min(2).max(1200),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1200) }).strict()).max(12).optional(),
}).strict();

const fallback = (message: string) => {
  const text = message.toLowerCase();
  if (text.includes("summarize")) return "Share the information you want summarized, and I’ll distill it into the key points and next steps.";
  if (text.includes("write") || text.includes("email") || text.includes("message")) return "Absolutely. Tell me who it’s for, the tone you want, and the main point to include.";
  if (text.includes("plan")) return "Let’s make a simple plan. What outcome are you working toward, and when do you need it?";
  return "I can help explain ideas, write and rewrite, summarize information, brainstorm, or make a practical plan. What would you like to work through?";
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return Response.json({ error: "Request origin not allowed." }, { status: 403 }); }
    catch { return Response.json({ error: "Request origin not allowed." }, { status: 403 }); }
  }
  let parsed: ReturnType<typeof requestSchema.safeParse>;
  try { parsed = requestSchema.safeParse(await request.json()); } catch { parsed = { success: false } as never; }
  if (!parsed.success) return Response.json({ error: "Enter a shorter valid message." }, { status: 400 });
  await requireOrganizationContext();

  const key = process.env.LEDGERLY_AI_API_KEY, model = process.env.LEDGERLY_AI_MODEL, endpoint = process.env.LEDGERLY_AI_BASE_URL;
  if (!key || !model || !endpoint) return Response.json({ answer: fallback(parsed.data.message) }, { headers: { "Cache-Control": "no-store" } });
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw Error("Unsupported provider URL");
    const response = await fetch(new URL("chat/completions", url.href.endsWith("/") ? url : `${url.href}/`), {
      method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: .4, messages: [
        { role: "system", content: "You are Ask General, Ledgerly’s general-purpose assistant. Help with explanations, writing, brainstorming, planning, and summaries. Do not access, infer, or mutate Ledgerly accounting records. Be concise, useful, and format with plain text, bullets, headings, tables, or code when appropriate." },
        ...(parsed.data.turns ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: parsed.data.message },
      ] }),
    });
    if (!response.ok) throw Error("Provider failed");
    const payload = await response.json();
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw Error("Empty response");
    return Response.json({ answer: answer.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ answer: fallback(parsed.data.message) }, { headers: { "Cache-Control": "no-store" } }); }
}
