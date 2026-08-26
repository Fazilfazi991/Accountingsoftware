"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok?: true; error?: string };
const fail = (message: string): ActionResult => ({ error: message });
const refresh = () => { revalidatePath("/", "layout"); };

export async function selectOrganization(organizationId: string): Promise<ActionResult> {
  const context = await requireOrganizationContext();
  if (!context.payload.organizations.some((organization) => organization.id === organizationId)) return fail("Organization access was denied.");
  const store = await cookies();
  store.set("ledgerly-org", organizationId, { httpOnly: true, sameSite: "lax", path: "/" });
  store.delete("ledgerly-branch");
  refresh();
  return { ok: true };
}

export async function selectBranch(branchId: string): Promise<ActionResult> {
  const context = await requireOrganizationContext();
  if (!context.payload.branches.some((branch) => branch.id === branchId)) return fail("Branch access was denied.");
  const store = await cookies();
  store.set("ledgerly-branch", branchId, { httpOnly: true, sameSite: "lax", path: "/" });
  refresh();
  return { ok: true };
}

export async function updateCompany(input: { name: string; legalName: string; currency: string; timezone: string }): Promise<ActionResult> {
  const context = await requireOrganizationContext();
  const { error } = await (await createClient()).rpc("update_organization_settings", { p_organization_id: context.organization.id, p_name: input.name.trim(), p_legal_name: input.legalName.trim(), p_currency: input.currency, p_timezone: input.timezone.trim() });
  if (error) return fail("Unable to save company settings.");
  refresh();
  return { ok: true };
}

export async function createBranch(name: string): Promise<ActionResult> {
  const context = await requireOrganizationContext();
  const { error } = await (await createClient()).rpc("create_organization_branch", { p_organization_id: context.organization.id, p_name: name.trim() });
  if (error) return fail("Unable to add branch.");
  refresh(); return { ok: true };
}

export async function updateBranch(input: { id: string; name: string; active: boolean }): Promise<ActionResult> {
  const context = await requireOrganizationContext();
  const { error } = await (await createClient()).rpc("update_organization_branch", { p_organization_id: context.organization.id, p_branch_id: input.id, p_name: input.name.trim(), p_status: input.active ? "active" : "inactive" });
  if (error) return fail(input.active ? "Unable to update branch." : "The final active branch cannot be deactivated.");
  if (!input.active && context.branch.id === input.id) (await cookies()).delete("ledgerly-branch");
  refresh(); return { ok: true };
}
