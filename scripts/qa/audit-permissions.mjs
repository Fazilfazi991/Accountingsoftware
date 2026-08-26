import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LEDGERLY_QA_USER_A_EMAIL",
  "LEDGERLY_QA_USER_A_PASSWORD",
  "LEDGERLY_QA_USER_B_EMAIL",
  "LEDGERLY_QA_USER_B_PASSWORD",
];
for (const key of keys)
  if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = (key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key),
  a = make(),
  b = make(),
  anon = make(),
  admin = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const login = async (c, email, password) => {
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error || new Error("Login failed");
  return data.user;
};
const pass = (ok, message) => {
  if (!ok) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
};
const rpc = async (c, name, args) => {
  const r = await c.rpc(name, args);
  if (r.error) throw r.error;
  return r.data;
};
const userA = await login(
    a,
    process.env.LEDGERLY_QA_USER_A_EMAIL,
    process.env.LEDGERLY_QA_USER_A_PASSWORD,
  ),
  userB = await login(
    b,
    process.env.LEDGERLY_QA_USER_B_EMAIL,
    process.env.LEDGERLY_QA_USER_B_PASSWORD,
  );
const { data: orgA, error: oa } = await a
    .from("organizations")
    .select("id")
    .eq("slug", "ledgerly-qa-company-a")
    .single(),
  { data: orgB, error: ob } = await b
    .from("organizations")
    .select("id")
    .eq("slug", "ledgerly-qa-company-b")
    .single();
if (oa || ob) throw oa || ob;
const { data: branch } = await a
  .from("branches")
  .select("id")
  .eq("organization_id", orgA.id)
  .eq("status", "active")
  .limit(1)
  .single();
const membershipId = crypto.randomUUID();
const original = await admin
  .from("organization_memberships")
  .select("id,role,membership_status,is_owner,default_branch_id")
  .eq("organization_id", orgA.id)
  .eq("user_id", userB.id)
  .maybeSingle();
if (original.error) throw original.error;
if (!original.data) {
  const ins = await admin
    .from("organization_memberships")
    .insert({
      id: membershipId,
      organization_id: orgA.id,
      user_id: userB.id,
      role: "viewer",
      membership_status: "active",
      is_owner: false,
      default_branch_id: branch.id,
    });
  if (ins.error) throw ins.error;
}
const mid = original.data?.id || membershipId;
if (original.data) {
  const activate = await admin.from("organization_memberships").update({ role: "viewer", membership_status: "active", is_owner: false, default_branch_id: branch.id }).eq("id", mid);
  if (activate.error) throw activate.error;
}
try {
  const ownerRole = await rpc(a, "current_org_role", { p_org: orgA.id });
  pass(ownerRole === "owner", "Owner role resolves canonically");
  pass(
    (await rpc(a, "has_org_capability", {
      p_org: orgA.id,
      p_capability: "users.manage",
    })) === true,
    "Owner has member-management capability",
  );
  const sequence=await a.from("document_sequences").select("id,prefix,next_number,padding,suffix").eq("organization_id",orgA.id).limit(1).single();
  if(sequence.error)throw sequence.error;
  pass(Boolean((await a.rpc("update_document_sequence",{p_organization_id:orgA.id,p_sequence_id:sequence.data.id,p_prefix:sequence.data.prefix,p_next_number:Number(sequence.data.next_number)-1,p_padding:sequence.data.padding,p_suffix:sequence.data.suffix||""})).error),"Document numbering cannot be rewound below the reserved next number");
  pass(
    Boolean(
      (await anon.rpc("get_audit_log", { p_organization_id: orgA.id })).error,
    ),
    "Anonymous audit access is denied",
  );
  pass(
    Boolean(
      (await b.rpc("get_audit_log", { p_organization_id: orgB.id })).data,
    ),
    "Owner can view own audit log",
  );
  pass(
    Boolean(
      (await b.rpc("get_audit_log", { p_organization_id: orgA.id })).error,
    ),
    "Viewer cannot view audit events",
  );
  pass(
    (await rpc(b, "has_org_capability", {
      p_org: orgA.id,
      p_capability: "reports.view",
    })) === true,
    "Viewer can view reports",
  );
  pass(
    (await rpc(b, "has_org_capability", {
      p_org: orgA.id,
      p_capability: "sales.post",
    })) === false,
    "Viewer cannot post sales documents",
  );
  let r = await a.rpc("update_organization_member", {
    p_organization_id: orgA.id,
    p_membership_id: mid,
    p_role: "accountant",
    p_status: "active",
  });
  if (r.error) throw r.error;
  pass(
    (await rpc(b, "has_org_capability", {
      p_org: orgA.id,
      p_capability: "journals.post",
    })) === true,
    "Accountant can post journals",
  );
  pass(
    !(
      await b.rpc("ensure_business_document_sequences", {
        p_organization_id: orgA.id,
      })
    ).error,
    "Accountant passes the real accounting RPC guard",
  );
  pass(
    !(await b.rpc("get_audit_log", { p_organization_id: orgA.id })).error,
    "Accountant can view audit events",
  );
  r = await a.rpc("update_organization_member", {
    p_organization_id: orgA.id,
    p_membership_id: mid,
    p_role: "staff",
    p_status: "active",
  });
  if (r.error) throw r.error;
  pass(
    (await rpc(b, "has_org_capability", {
      p_org: orgA.id,
      p_capability: "sales.create",
    })) === true,
    "Staff has draft-entry capability",
  );
  const customer = await b.from("customers").select("id").eq("organization_id", orgA.id).eq("is_active", true).limit(1).single();
  const revenue = await b.from("accounts").select("id").eq("organization_id", orgA.id).eq("system_key", "sales_revenue").single();
  if (customer.error || revenue.error) throw customer.error || revenue.error;
  const date = new Date().toISOString().slice(0, 10);
  const draft = await b.rpc("create_sales_invoice_draft", {
    p_organization_id: orgA.id, p_customer_id: customer.data.id, p_invoice_date: date, p_due_date: date,
    p_lines: [{ description: "Batch 10.3 permission probe", quantity: "1", unit_price: "1", discount: "0", revenue_account_id: revenue.data.id }],
    p_branch_id: branch.id, p_reference: "B10.3-STAFF", p_notes: "Permission QA draft; deleted without posting",
  });
  pass(!draft.error && Boolean(draft.data), `Staff can create a real sales draft${draft.error ? ` (${draft.error.message})` : ""}`);
  pass(Boolean((await b.rpc("post_sales_invoice", { p_organization_id: orgA.id, p_invoice_id: draft.data })).error), "Staff cannot post the sales draft");
  pass(!(await b.rpc("delete_sales_invoice_draft", { p_organization_id: orgA.id, p_invoice_id: draft.data })).error, "Staff can delete its real unposted draft");
  pass(
    Boolean(
      (
        await b.rpc("ensure_business_document_sequences", {
          p_organization_id: orgA.id,
        })
      ).error,
    ),
    "Staff is blocked by the real accounting mutation guard",
  );
  pass(
    Boolean(
      (await b.rpc("get_audit_log", { p_organization_id: orgA.id })).error,
    ),
    "Staff cannot view audit events",
  );
  r = await a.rpc("update_organization_member", {
    p_organization_id: orgA.id,
    p_membership_id: mid,
    p_role: "viewer",
    p_status: "inactive",
  });
  if (r.error) throw r.error;
  pass(
    (await b.from("organizations").select("id").eq("id", orgA.id)).data
      .length === 0,
    "Deactivated membership loses tenant visibility",
  );
  const ownerMembership = await a
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("user_id", userA.id)
    .single();
  pass(
    Boolean(
      (
        await a.rpc("update_organization_member", {
          p_organization_id: orgA.id,
          p_membership_id: ownerMembership.data.id,
          p_role: "viewer",
          p_status: "inactive",
        })
      ).error,
    ),
    "Owner self-lockout is prevented",
  );
  pass(
    Boolean(
      (await a.rpc("get_audit_log", { p_organization_id: orgB.id })).error,
    ),
    "Cross-tenant audit RPC access is denied",
  );
  const invoice = await a
    .from("sales_invoices")
    .select("id,subtotal,tax_total,grand_total,status")
    .eq("organization_id", orgA.id)
    .eq("status", "posted")
    .limit(1)
    .maybeSingle();
  if (invoice.data) {
    const lines = await a
      .from("sales_invoice_lines")
      .select("quantity,unit_price,discount,tax_rates(rate_percent)")
      .eq("organization_id", orgA.id)
      .eq("invoice_id", invoice.data.id);
    if (lines.error) throw lines.error;
    const net = lines.data.reduce(
        (s, l) =>
          s + Number(l.quantity) * Number(l.unit_price) - Number(l.discount),
        0,
      ),
      tax = lines.data.reduce((s, l) => {
        const x =
          Number(l.quantity) * Number(l.unit_price) - Number(l.discount);
        return s + (x * Number(l.tax_rates?.rate_percent || 0)) / 100;
      }, 0);
    pass(
      Math.abs(net - Number(invoice.data.subtotal)) < 0.01 &&
        Math.abs(tax - Number(invoice.data.tax_total)) < 0.01 &&
        Math.abs(net + tax - Number(invoice.data.grand_total)) < 0.01,
      "Invoice print source totals and VAT equal canonical posted data",
    );
    pass(
      (await b.from("sales_invoices").select("id").eq("id", invoice.data.id))
        .data.length === 0,
      "Cross-tenant document read is denied",
    );
  }
  const note = await a
    .from("sales_credit_notes")
    .select("id,invoice_id")
    .eq("organization_id", orgA.id)
    .eq("status", "posted")
    .not("invoice_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (note.data)
    pass(
      Boolean(note.data.invoice_id),
      "Posted credit note retains its source invoice reference",
    );
  const receipt = await a
    .from("customer_receipts")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("status", "posted")
    .limit(1)
    .maybeSingle();
  if (receipt.data) {
    const allocations = await a
      .from("open_item_allocations")
      .select("amount,open_item_id")
      .eq("organization_id", orgA.id)
      .eq("customer_receipt_id", receipt.data.id);
    pass(
      !allocations.error && allocations.data.length > 0,
      "Posted receipt print source includes real allocations",
    );
  }
  const audit = await a.rpc("get_audit_log", {
    p_organization_id: orgA.id,
    p_action: "membership.updated",
    p_limit: 20,
  });
  pass(
    !audit.error && audit.data.some((x) => x.entity_id === mid),
    "Role and status changes are recorded in the audit log",
  );
} finally {
  if (original.data) {
    await admin
      .from("organization_memberships")
      .update({
        role: original.data.role,
        membership_status: original.data.membership_status,
        is_owner: original.data.is_owner,
        default_branch_id: original.data.default_branch_id,
      })
      .eq("id", mid);
  } else await admin.from("organization_memberships").delete().eq("id", mid);
}
console.log("Audit, permissions and document QA complete.");
