import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

const status = process.argv[2];
if (!['active', 'inactive'].includes(status) || process.env.LEDGERLY_QA_ALLOW_PRIVILEGED_FIXTURE_MUTATION !== 'true') throw new Error('QA fixture mutation is not authorized');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: users, error: userError } = await admin.auth.admin.listUsers();
if (userError) throw userError;
const user = users.users.find((item) => item.email === 'ledgerly-qa-user-a@ledgerly.test');
if (!user) throw new Error('Expected User A fixture not found');
const { data: org, error: orgError } = await admin.from('organizations').select('id').eq('slug', 'ledgerly-qa-company-a').single();
if (orgError || !org) throw new Error('Expected Company A fixture not found');
const { data: membership, error: membershipError } = await admin.from('organization_memberships').select('id,user_id,organization_id').eq('user_id', user.id).eq('organization_id', org.id).single();
if (membershipError || !membership || membership.user_id !== user.id || membership.organization_id !== org.id) throw new Error('Expected QA membership not found');
const { error: updateError } = await admin.from('organization_memberships').update({ membership_status: status }).eq('id', membership.id);
if (updateError) throw updateError;
console.log(`PASS QA fixture set User A membership ${status}`);
