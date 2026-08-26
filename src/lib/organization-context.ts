import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type OrganizationContextPayload = {
  user: { id: string; displayName: string };
  membership: { id: string; role: "owner" | "admin" | "accountant" | "staff" | "viewer"; isOwner: boolean };
  organization: { id: string; name: string; legalName: string; trn: string; email: string; phone: string; address: string; emirate: string; countryCode: string; currency: string; timezone: string };
  branch: { id: string; name: string; code: string; address: string; email: string; phone: string };
  organizations: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  allBranches: { id: string; name: string; code: string; address: string; email: string; phone: string; defaultLocationId: string; active: boolean }[];
};

export async function requireOrganizationContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const { data: memberships } = await supabase.from("organization_memberships").select("id, organization_id, default_branch_id, role, is_owner, organizations!inner(id,name,legal_name,trn,email,phone,address,emirate,country_code,base_currency,timezone,status)").eq("user_id", user.id).eq("membership_status", "active").eq("organizations.status", "active");
  if (!memberships?.length) redirect("/onboarding");
  const store = await cookies();
  const requestedOrganizationId = store.get("ledgerly-org")?.value;
  const membership = memberships.find((item) => item.organization_id === requestedOrganizationId) ?? memberships[0];
  const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
  if (!organization) redirect("/onboarding");
  const { data: allBranches } = await supabase.from("branches").select("id,name,code,address,email,phone,default_inventory_location_id,status").eq("organization_id", organization.id).order("name");
  const branches = allBranches ?? [];
  const activeBranches = branches.filter((item) => item.status === "active");
  if (!activeBranches?.length) redirect("/onboarding");
  const requestedBranchId = store.get("ledgerly-branch")?.value;
  const branch = activeBranches.find((item) => item.id === requestedBranchId) ?? activeBranches.find((item) => item.id === membership.default_branch_id) ?? activeBranches[0];
  return {
    user,
    membership,
    organization,
    branch,
    payload: {
      user: { id: user.id, displayName: profile?.display_name?.trim() || user.email?.split("@")[0] || "there" },
      membership: { id: membership.id, role: membership.is_owner ? "owner" : membership.role, isOwner: membership.is_owner },
      organization: { id: organization.id, name: organization.name, legalName: organization.legal_name || "", trn: organization.trn || "", email: organization.email || "", phone: organization.phone || "", address: organization.address || "", emirate: organization.emirate || "Dubai", countryCode: organization.country_code || "AE", currency: organization.base_currency, timezone: organization.timezone },
      branch: { id: branch.id, name: branch.name, code: branch.code || "", address: branch.address || "", email: branch.email || "", phone: branch.phone || "" },
      organizations: memberships.map((item) => {
        const org = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations;
        return { id: org!.id, name: org!.name };
      }),
      branches: activeBranches.map((item) => ({ id: item.id, name: item.name })),
      allBranches: branches.map((item) => ({ id: item.id, name: item.name, code: item.code || "", address: item.address || "", email: item.email || "", phone: item.phone || "", defaultLocationId: item.default_inventory_location_id || "", active: item.status === "active" })),
    } satisfies OrganizationContextPayload,
  };
}
