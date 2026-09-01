import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import "./safety.mjs";

const needed = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "LEDGERLY_QA_USER_A_EMAIL", "LEDGERLY_QA_USER_A_PASSWORD", "LEDGERLY_QA_USER_B_EMAIL", "LEDGERLY_QA_USER_B_PASSWORD"];
for (const key of needed) if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const a = make(), b = make(), anon = make();
const assert = (ok, message) => { if (!ok) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const login = async (client, email, password) => { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error || !data.user) throw new Error("QA login failed"); };
const count = async (client, table, column, id) => { const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq(column, id); if (error) throw error; return count; };

await login(a, process.env.LEDGERLY_QA_USER_A_EMAIL, process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b, process.env.LEDGERLY_QA_USER_B_EMAIL, process.env.LEDGERLY_QA_USER_B_PASSWORD);
const { data: orgA } = await a.from("organizations").select("id").eq("slug", "ledgerly-qa-company-a").single();
const { data: orgB } = await b.from("organizations").select("id").eq("slug", "ledgerly-qa-company-b").single();
assert(Boolean(orgA && orgB), "QA organizations resolve through normal sessions");
for (const table of ["organizations", "organization_memberships", "branches", "organization_settings", "audit_events"]) {
  const column = table === "organizations" ? "id" : "organization_id";
  assert((await count(a, table, column, orgA.id)) > 0, `User A can read own ${table}`);
  assert((await count(a, table, column, orgB.id)) === 0, `User A cannot read Company B ${table}`);
  assert((await count(b, table, column, orgB.id)) > 0, `User B can read own ${table}`);
  assert((await count(b, table, column, orgA.id)) === 0, `User B cannot read Company A ${table}`);
  const { count: anonymousCount, error } = await anon.from(table).select("*", { count: "exact", head: true });
  assert(Boolean(error) || anonymousCount === 0, `Anonymous cannot read ${table}`);
}
const updateA = await a.from("organizations").update({ name: "blocked" }).eq("id", orgB.id).select("id");
assert(Boolean(updateA.error) || updateA.data.length === 0, "User A cross-tenant organization update denied");
const updateB = await b.from("branches").update({ name: "blocked" }).eq("organization_id", orgA.id).select("id");
assert(Boolean(updateB.error) || updateB.data.length === 0, "User B cross-tenant branch update denied");
const { data: event } = await a.from("audit_events").select("id").eq("organization_id", orgA.id).limit(1).single();
assert(event, "User A can resolve a permitted audit event");
const auditUpdate = await a.from("audit_events").update({ event_type: "tampered" }).eq("id", event.id).select("id");
assert(Boolean(auditUpdate.error) || auditUpdate.data.length === 0, "Audit update denied");
const auditDelete = await a.from("audit_events").delete().eq("id", event.id).select("id");
assert(Boolean(auditDelete.error) || auditDelete.data.length === 0, "Audit delete denied");
assert((await a.rpc("update_organization", { p_organization_id: orgB.id, p_name: "blocked", p_legal_name: "", p_timezone: "Asia/Dubai" })).error, "User A cross-tenant RPC denied");
assert((await b.rpc("update_organization", { p_organization_id: orgA.id, p_name: "blocked", p_legal_name: "", p_timezone: "Asia/Dubai" })).error, "User B cross-tenant RPC denied");
assert((await anon.rpc("create_organization", { p_name: "blocked", p_legal_name: "", p_slug: "blocked-anon", p_branch_name: "blocked" })).error, "Anonymous create-organization RPC denied");
assert((await count(a, "organizations", "id", orgA.id)) === 1, "User A initially active");
try {
  execFileSync(process.execPath, ["scripts/qa/tenant-isolation-admin.mjs", "inactive"], { stdio: "inherit", env: process.env });
  for (const table of ["organizations", "branches", "organization_settings", "audit_events"]) { const column = table === "organizations" ? "id" : "organization_id"; assert((await count(a, table, column, orgA.id)) === 0, `Inactive User A cannot read ${table}`); }
} finally {
  execFileSync(process.execPath, ["scripts/qa/tenant-isolation-admin.mjs", "active"], { stdio: "inherit", env: process.env });
}
assert((await count(a, "organizations", "id", orgA.id)) === 1, "Restored User A can read Company A");
