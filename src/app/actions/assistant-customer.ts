"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { getParties, saveParty } from "./controls";
import { customerActionCommandSchema, type CustomerActionArgs } from "@/lib/assistant/action-registry";
import { customerValidationMessage } from "@/lib/party-validation";
import { likelyCustomerDuplicates, type CustomerCandidate, type CustomerDuplicate } from "@/lib/assistant/customer-duplicates";

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

export async function saveAssistantCustomer(command: unknown, expectedBranchId: string, continueAnyway: boolean): Promise<
  { id: string; name: string; email: string; phone: string; trn: string } |
  { duplicateWarning: CustomerDuplicate[] } | { error: string; safeToRetry: boolean }
> {
  const parsed = customerActionCommandSchema.safeParse(command);
  if (!parsed.success) return { error: customerValidationMessage(parsed.error.issues), safeToRetry: true };
  if (!(await canCreateAssistantCustomer())) return { error: "You do not have permission to add customers.", safeToRetry: true };
  const context = await requireOrganizationContext();
  if (context.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const data = await getAssistantCustomerData();
  if ("error" in data) return { error: data.error, safeToRetry: true };
  if (data.branch.id !== expectedBranchId)
    return { error: "The selected branch changed. Return to Assistant and start again.", safeToRetry: true };
  const args: CustomerActionArgs = parsed.data.args;
  const duplicates = likelyCustomerDuplicates(args, data.customers);
  if (duplicates.length && continueAnyway !== true) return { duplicateWarning: duplicates };
  if (data.customers.some((candidate) => candidate.name === args.name.trim()))
    return { error: "That exact customer name already exists. Edit the name or use the existing customer.", safeToRetry: true };
  // The ordinary saveParty action remains the only write path. Its kind and active state are fixed here.
  const saved = await saveParty({ kind: "customer", name: args.name, trn: args.trn,
    email: args.email, phone: args.phone, address: args.address,
    paymentTermsDays: args.paymentTermsDays, active: true });
  if ("error" in saved) return { error: saved.error || "Customer result could not be confirmed.", safeToRetry: false };
  return { id: String(saved.id), name: args.name, email: args.email || "",
    phone: args.phone || "", trn: args.trn || "" };
}
