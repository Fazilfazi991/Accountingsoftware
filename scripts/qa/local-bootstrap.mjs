import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "LEDGERLY_QA_USER_A_EMAIL", "LEDGERLY_QA_USER_A_PASSWORD", "LEDGERLY_QA_USER_B_EMAIL", "LEDGERLY_QA_USER_B_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const fixtures = [
  { email: process.env.LEDGERLY_QA_USER_A_EMAIL, password: process.env.LEDGERLY_QA_USER_A_PASSWORD, slug: "ledgerly-qa-company-a", name: "Local QA Company A" },
  { email: process.env.LEDGERLY_QA_USER_B_EMAIL, password: process.env.LEDGERLY_QA_USER_B_PASSWORD, slug: "ledgerly-qa-company-b", name: "Local QA Company B" },
];

for (const fixture of fixtures) {
  let user = (await admin.auth.admin.listUsers()).data.users.find((item) => item.email === fixture.email);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email: fixture.email, password: fixture.password, email_confirm: true });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  const client = anon();
  const login = await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password });
  if (login.error) throw login.error;
  const existing = await client.from("organizations").select("id").eq("slug", fixture.slug).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const created = await client.rpc("create_organization", { p_name: fixture.name, p_legal_name: fixture.name, p_slug: fixture.slug, p_branch_name: "Main" });
    if (created.error) throw created.error;
  }
}

console.log("PASS deterministic local users and organizations created");
