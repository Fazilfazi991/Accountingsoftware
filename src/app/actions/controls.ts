"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const opt = z.string().trim().max(500).optional();
const companySchema = z.object({
  name: z.string().trim().min(1).max(160),
  legalName: opt,
  trn: z.string().trim().max(30).optional(),
  email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().trim().max(40).optional(),
  address: opt,
  emirate: z.string().trim().min(1).max(60),
  countryCode: z.literal("AE"),
  currency: z.literal("AED"),
  timezone: z.literal("Asia/Dubai"),
});
const branchSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(30).optional(),
  address: opt,
  email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().trim().max(40).optional(),
  active: z.boolean(),
  defaultLocationId: z.string().uuid().optional(),
});
const partySchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["customer", "supplier"]),
  name: z.string().trim().min(1).max(160),
  trn: z.string().trim().max(30).optional(),
  email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().trim().max(40).optional(),
  address: opt,
  paymentTermsDays: z.coerce.number().int().min(0).max(3650),
  active: z.boolean(),
});
const roleSchema = z.enum(["owner", "admin", "accountant", "staff", "viewer"]),
  statusSchema = z.enum(["active", "inactive"]);

const friendly = (raw: string) =>
  raw.includes("not_authorized")
    ? "You do not have permission for this action."
    : raw.includes("lockout")
      ? "Owner and self-lockout protection prevented this change."
      : raw.includes("last_active_branch")
        ? "The final active branch cannot be deactivated."
        : "The change could not be saved.";

export async function getControlData() {
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      org = context.organization.id;
    const [members, locations] = await Promise.all([
      client.rpc("get_organization_members", { p_organization_id: org }),
      client
        .from("inventory_locations")
        .select("id,branch_id,name,status")
        .eq("organization_id", org)
        .eq("status", "active")
        .order("name"),
    ]);
    return {
      members: members.error ? [] : members.data || [],
      locations: locations.data || [],
      canManageUsers: !members.error,
    };
  } catch {
    return { members: [], locations: [], canManageUsers: false };
  }
}
export async function saveCompany(value: unknown) {
  const p = companySchema.safeParse(value);
  if (!p.success) return { error: "Enter valid company details." };
  const c = await requireOrganizationContext(),
    s = await createClient(),
    v = p.data,
    { error } = await s.rpc("update_company_profile", {
      p_organization_id: c.organization.id,
      p_name: v.name,
      p_legal_name: v.legalName || "",
      p_trn: v.trn || "",
      p_email: v.email || "",
      p_phone: v.phone || "",
      p_address: v.address || "",
      p_emirate: v.emirate,
      p_country_code: v.countryCode,
      p_currency: v.currency,
      p_timezone: v.timezone,
    });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
export async function saveBranch(value: unknown) {
  const p = branchSchema.safeParse(value);
  if (!p.success) return { error: "Enter valid branch details." };
  const c = await requireOrganizationContext(),
    s = await createClient(),
    v = p.data,
    { error } = await s.rpc("save_organization_branch", {
      p_organization_id: c.organization.id,
      p_branch_id: v.id || null,
      p_name: v.name,
      p_code: v.code || "",
      p_address: v.address || "",
      p_email: v.email || "",
      p_phone: v.phone || "",
      p_status: v.active ? "active" : "inactive",
      p_default_inventory_location_id: v.defaultLocationId || null,
    });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
export async function updateMember(value: {
  membershipId: string;
  role: string;
  status: string;
}) {
  const id = z.string().uuid().safeParse(value.membershipId),
    role = roleSchema.safeParse(value.role),
    status = statusSchema.safeParse(value.status);
  if (!id.success || !role.success || !status.success)
    return { error: "Invalid membership change." };
  const c = await requireOrganizationContext(),
    s = await createClient(),
    { error } = await s.rpc("update_organization_member", {
      p_organization_id: c.organization.id,
      p_membership_id: id.data,
      p_role: role.data,
      p_status: status.data,
    });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
export async function getAuditLog(
  filters: {
    from?: string;
    to?: string;
    userId?: string;
    action?: string;
    branchId?: string;
    entityType?: string;
  } = {},
) {
  try {
    const c = await requireOrganizationContext(),
      s = await createClient(),
      to = filters.to ? new Date(`${filters.to}T00:00:00Z`) : null;
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    const { data, error } = await s.rpc("get_audit_log", {
      p_organization_id: c.organization.id,
      p_from: filters.from ? `${filters.from}T00:00:00Z` : null,
      p_to: to?.toISOString() || null,
      p_user_id: filters.userId || null,
      p_action: filters.action || null,
      p_branch_id: filters.branchId || null,
      p_entity_type: filters.entityType || null,
      p_limit: 250,
    });
    if (error) return { error: friendly(error.message) };
    return { rows: (data || []) as any[] };
  } catch {
    return { error: "Unable to load the audit log." };
  }
}
export async function getParties(kind: "customer" | "supplier") {
  try {
    const c = await requireOrganizationContext(),
      s = await createClient(),
      { data, error } = await s
        .from(kind === "customer" ? "customers" : "suppliers")
        .select(
          "id,name,trn,email,phone,billing_address,payment_terms_days,is_active",
        )
        .eq("organization_id", c.organization.id)
        .order("name");
    if (error) return { error: "Unable to load party records." };
    return { rows: data || [] };
  } catch {
    return { error: "Unable to load party records." };
  }
}
export async function saveParty(value: unknown) {
  const p = partySchema.safeParse(value);
  if (!p.success) return { error: "Enter valid party details." };
  const c = await requireOrganizationContext(),
    s = await createClient(),
    v = p.data,
    { data, error } = await s.rpc("save_party", {
      p_organization_id: c.organization.id,
      p_kind: v.kind,
      p_id: v.id || null,
      p_name: v.name,
      p_trn: v.trn || "",
      p_email: v.email || "",
      p_phone: v.phone || "",
      p_address: v.address || "",
      p_payment_terms_days: v.paymentTermsDays,
      p_is_active: v.active,
    });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true as const, id: data as string };
}
