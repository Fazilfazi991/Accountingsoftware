"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim(); const legal = String(formData.get("legal") ?? "").trim(); const branch = String(formData.get("branch") ?? "").trim();
  if (!name || !branch) redirect("/onboarding?error=Company+and+branch+names+are+required");
  const { error } = await (await createClient()).rpc("create_organization", { p_name: name, p_legal_name: legal, p_slug: `${slug(name)}-${Date.now().toString(36)}`, p_branch_name: branch });
  if (error) redirect("/onboarding?error=Company+could+not+be+created");
  redirect("/");
}
