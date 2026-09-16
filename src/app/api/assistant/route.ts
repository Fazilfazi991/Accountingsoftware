import { requireOrganizationContext } from "@/lib/organization-context";
import { getPlanner, ProviderUnavailableError } from "@/lib/assistant/planner";
import { requestSchema, sanitizeTurns, validatePlan } from "@/lib/assistant/registry";
import { executeAssistantTool } from "@/lib/assistant/tools";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  if (origin && host) { try { if (new URL(origin).host !== host) return Response.json({ error: "Request origin not allowed." }, { status: 403 }); }
    catch { return Response.json({ error: "Request origin not allowed." }, { status: 403 }); } }
  if (Number(request.headers.get("content-length") || 0) > 12000) return Response.json({ error: "Question is too long." }, { status: 413 });
  let parsed: ReturnType<typeof requestSchema.safeParse>;
  try { const body = await request.text(); if (body.length > 12000) throw Error("Too long"); parsed = requestSchema.safeParse(JSON.parse(body)); }
  catch { return Response.json({ error: "Enter a shorter valid question." }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Enter a shorter valid question." }, { status: 400 });
  // Authentication occurs before the provider call, so unauthenticated clients cannot consume AI capacity.
  await requireOrganizationContext();
  try {
    const turns = sanitizeTurns(parsed.data.turns);
    const plan = validatePlan(await getPlanner().plan(parsed.data.message, turns));
    const answer = await executeAssistantTool(plan);
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) return Response.json({ error: "Ask FYNTA couldn't understand that request right now. Please retry or choose a guided action." }, { status: 503 });
    return Response.json({ error: "Ask FYNTA could not understand that question. Try a more specific one." }, { status: 400 });
  }
}
