"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim(); const legal = String(formData.get("legal") ?? "").trim(); const branch = String(formData.get("branch") ?? "").trim();
  if (!name || !branch) redirect("/onboarding?error=Company+and+branch+names+are+required");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("create_organization", { p_name: name, p_legal_name: legal, p_slug: `${slug(name)}-${randomUUID().slice(0, 12)}`, p_branch_name: branch });
  if (error) redirect("/onboarding?error=Company+could+not+be+created");
  redirect("/");
}
