"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getParties } from "./controls";
import { customerActionCommandSchema, type CustomerActionArgs } from "@/lib/assistant/action-registry";
import { customerValidationMessage } from "@/lib/party-validation";
import { type CustomerCandidate, type CustomerDuplicate } from "@/lib/assistant/customer-duplicates";
import { requestKeySchema, assistantWriteError } from "@/lib/assistant/write-request";
import { revalidatePath } from "next/cache";

export type AssistantCustomerData = { branch: { id: string; name: string }; customers: CustomerCandidate[] };

export async function canCreateAssistantCustomer(): Promise<boolean> {
  const context = await requireOrganizationContext(), client = await createClient();
  const { data, error } = await client.rpc("has_org_capability", {
    p_org: context.organization.id, p_capability: "masters.manage",
  });
  return !error && data === true;
}

export async function getAssistantCustomerData(): Promise<AssistantCustomerData | { error: string }> {
  if (!(await canCreateAssistantCustomer())) return { error: "You do not have permission to add customers." };
  const context = await requireOrganizationContext(), result = await getParties("customer");
  if ("error" in result) return { error: result.error || "Unable to load customer records." };
  return { branch: { id: context.branch.id, name: context.branch.name }, customers: result.rows || [] };
}

export async function saveAssistantCustomer(command: unknown, expectedBranchId: string, continueAnyway: boolean,
  requestKey: string): Promise<
  { id: string; name: string; email: string; phone: string; trn: string } |
  { duplicateWarning: CustomerDuplicate[] } | { error: string; safeToRetry: boolean }
> {
  const parsed = customerActionCommandSchema.safeParse(command);
  if (!parsed.success) return { error: customerValidationMessage(parsed.error.issues), safeToRetry: true };
  if (!requestKeySchema.safeParse(requestKey).success) return { error: "Invalid write request ID. Start this action again.", safeToRetry: false };
  if (!(await canCreateAssistantCustomer())) return { error: "You do not have permission to add customers.", safeToRetry: true };
  const context = await requireOrganizationContext();
  if (context.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const args: CustomerActionArgs = parsed.data.args;
  const client = await createClient();
  const params = { p_org: context.organization.id, p_branch: context.branch.id,
    p_action: "create_customer", p_request_key: requestKey, p_payload: args };
  const { data: prior, error: lookupError } = await client.rpc("lookup_assistant_write", params);
  if (lookupError) return { error: assistantWriteError(lookupError.message),
    safeToRetry: !lookupError.message.includes("assistant_write_payload_mismatch") &&
      !lookupError.message.includes("assistant_write_scope_mismatch") };
  if (prior) {
    if (!requestKeySchema.safeParse(prior.id).success)
      return { error: "The prior customer result could not be confirmed.", safeToRetry: true };
    return { id: String(prior.id), name: String(prior.name), email: String(prior.email || ""),
      phone: String(prior.phone || ""), trn: String(prior.trn || "") };
  }
  const data = await getAssistantCustomerData();
  if ("error" in data) return { error: data.error, safeToRetry: true };
  if (data.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  // The guided preview already requires an explicit "Continue Anyway" for similar
  // names. Re-running that advisory after a successful but lost response would
  // incorrectly block a same-key replay, so it is not a write-boundary guard.
  void continueAnyway;
  // Exact-name checks must not block a legitimate replay. The domain transaction
  // itself owns the result; duplicate suggestions remain advisory before confirmation.
  const { data: saved, error } = await client.rpc("execute_assistant_write", params);
  if (error) return { error: assistantWriteError(error.message),
    safeToRetry: !error.message.includes("assistant_write_payload_mismatch") &&
      !error.message.includes("assistant_write_scope_mismatch") };
  if (!requestKeySchema.safeParse(saved?.id).success)
    return { error: "The customer result could not be confirmed. Retry with the same request ID.", safeToRetry: true };
  revalidatePath("/", "layout");
  return { id: String(saved.id), name: String(saved.name), email: String(saved.email || ""),
    phone: String(saved.phone || ""), trn: String(saved.trn || "") };
}
