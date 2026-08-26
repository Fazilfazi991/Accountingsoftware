import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "LEDGERLY_QA_USER_A_EMAIL", "LEDGERLY_QA_USER_A_PASSWORD", "LEDGERLY_QA_USER_B_EMAIL", "LEDGERLY_QA_USER_B_PASSWORD"];
for (const key of keys) if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const assert = (value, message) => { if (!value) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const login = async (client, email, password) => { const { error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; };
const a = make(), b = make(), anon = make();
await login(a, process.env.LEDGERLY_QA_USER_A_EMAIL, process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b, process.env.LEDGERLY_QA_USER_B_EMAIL, process.env.LEDGERLY_QA_USER_B_PASSWORD);
const { data: orgA } = await a.from("organizations").select("id").eq("slug", "ledgerly-qa-company-a").single();
const { data: orgB } = await b.from("organizations").select("id").eq("slug", "ledgerly-qa-company-b").single();
assert(orgA && orgB, "QA tenants resolve");
for (const clientAndOrg of [[a, orgA], [b, orgB]]) { const [client, org] = clientAndOrg; const { data, error } = await client.rpc("initialize_accounting_setup", { p_organization_id: org.id }); assert(!error && data?.initialized, "Owner initialization succeeds"); const { data: replay, error: replayError } = await client.rpc("initialize_accounting_setup", { p_organization_id: org.id }); assert(!replayError && replay?.already_initialized, "Initialization is idempotent"); }
const { data: yearA } = await a.from("financial_years").select("id,start_date").eq("organization_id", orgA.id).eq("is_default", true).single();
const draft = await a.rpc("create_opening_balance_batch", { p_organization_id: orgA.id, p_financial_year_id: yearA.id, p_opening_date: yearA.start_date, p_notes: "QA draft" });
assert(!draft.error && draft.data, "Owner can create an opening-balance draft without posting a ledger");
for (const table of ["account_groups", "accounts", "cash_accounts", "bank_accounts", "financial_years", "tax_rates", "document_sequences", "opening_balance_batches"]) { const own = await a.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgA.id); const other = await a.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgB.id); const anonymous = await anon.from(table).select("id", { count: "exact", head: true }); assert(!own.error && own.count > 0, `User A reads own ${table}`); assert(!other.error && other.count === 0, `User A cannot read B ${table}`); assert(Boolean(anonymous.error) || anonymous.count === 0, `Anonymous cannot read ${table}`); }
const { data: accountB } = await b.from("accounts").select("id,account_group_id,code,name").eq("organization_id", orgB.id).limit(1).single();
const cross = await a.rpc("update_account", { p_organization_id: orgB.id, p_account_id: accountB.id, p_code: accountB.code, p_name: "blocked", p_account_group_id: accountB.account_group_id, p_description: "", p_allow_manual_posting: true, p_is_active: true });
assert(Boolean(cross.error), "Cross-tenant account mutation denied");
const { data: systemAccount } = await a.from("accounts").select("id,account_group_id,code,name").eq("organization_id", orgA.id).eq("system_key", "cash_on_hand").single();
const protectedResult = await a.rpc("update_account", { p_organization_id: orgA.id, p_account_id: systemAccount.id, p_code: systemAccount.code, p_name: systemAccount.name, p_account_group_id: systemAccount.account_group_id, p_description: "", p_allow_manual_posting: true, p_is_active: false });
assert(Boolean(protectedResult.error), "System account deactivation denied");
