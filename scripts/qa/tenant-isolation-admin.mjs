import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import "./safety.mjs";

const status = process.argv[2];
if (!['active', 'inactive'].includes(status) || process.env.LEDGERLY_QA_ALLOW_PRIVILEGED_FIXTURE_MUTATION !== 'true') throw new Error('QA fixture mutation is not authorized');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: users, error: userError } = await admin.auth.admin.listUsers();
if (userError) throw userError;
const user = users.users.find((item) => item.email === 'ledgerly-qa-user-a@ledgerly.test');
if (!user) throw new Error('Expected User A fixture not found');
const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (!['127.0.0.1','localhost'].includes(api.hostname)) throw new Error('Direct fixture administration is local-only');
const sql = `update public.organization_memberships set membership_status='${status}' where user_id='${user.id}'::uuid and organization_id=(select id from public.organizations where slug='ledgerly-qa-company-a') returning id;`;
const updated = execFileSync('docker', ['exec', process.env.LEDGERLY_QA_LOCAL_DB_CONTAINER || 'supabase_db_Accounting_Software', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding:'utf8' }).trim();
if (!updated) throw new Error('Expected QA membership not found');
console.log(`PASS QA fixture set User A membership ${status}`);
