import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "LEDGERLY_QA_USER_A_EMAIL", "LEDGERLY_QA_USER_A_PASSWORD", "LEDGERLY_QA_USER_B_EMAIL", "LEDGERLY_QA_USER_B_PASSWORD"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const n = (value) => Number(value);
const same = (a, b) => Math.abs(n(a) - n(b)) < 0.000001;
const ok = (value, message) => { if (!value) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const rpc = (client, fn, args) => client.rpc(fn, args);
const login = async (client, email, password) => { const { error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; };

export async function runSettlementSuite(kind) {
  const receipt = kind === "receipt";
  const label = receipt ? "Customer Receipt" : "Supplier Payment";
  const cfg = receipt ? {
    table: "customer_receipts", id: "receipt_id", number: "receipt_number", party: "customer_id", allocation: "customer_receipt_id", create: "create_customer_receipt_draft", update: "update_customer_receipt_draft", remove: "delete_customer_receipt_draft", post: "post_customer_receipt", partyRpc: "create_customer", sourceRpc: "create_sales_invoice_draft", postSource: "post_sales_invoice", sourceTable: "sales_invoices", sourceId: "p_invoice_id", control: "accounts_receivable", offset: "sales_revenue", primaryNet: 1000, primaryTotal: 1050, paid: 500, remaining: 550, sourceArgs: (org, party, line, ref, date) => ({ p_organization_id: org, p_customer_id: party, p_invoice_date: date, p_due_date: date, p_lines: [line], p_reference: ref }), draftArgs: (org, party, date, cash, total, ref) => ({ p_organization_id: org, p_customer_id: party, p_receipt_date: date, p_cash_account_id: cash, p_amount: total, p_allocations: [], p_reference: ref })
  } : {
    table: "supplier_payments", id: "payment_id", number: "payment_number", party: "supplier_id", allocation: "supplier_payment_id", create: "create_supplier_payment_draft", update: "update_supplier_payment_draft", remove: "delete_supplier_payment_draft", post: "post_supplier_payment", partyRpc: "create_supplier", sourceRpc: "create_purchase_bill_draft", postSource: "post_purchase_bill", sourceTable: "purchase_bills", sourceId: "p_bill_id", control: "accounts_payable", offset: "rent_expense", primaryNet: 400, primaryTotal: 420, paid: 200, remaining: 220, sourceArgs: (org, party, line, ref, date) => ({ p_organization_id: org, p_supplier_id: party, p_bill_date: date, p_due_date: date, p_lines: [line], p_reference: ref }), draftArgs: (org, party, date, cash, total, ref) => ({ p_organization_id: org, p_supplier_id: party, p_payment_date: date, p_cash_account_id: cash, p_amount: total, p_reference: ref })
  };
  const run = `${receipt ? "CR" : "SP"}-QA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const today = new Date().toISOString().slice(0, 10), a = make(), b = make(), anon = make();
  await login(a, process.env.LEDGERLY_QA_USER_A_EMAIL, process.env.LEDGERLY_QA_USER_A_PASSWORD); await login(b, process.env.LEDGERLY_QA_USER_B_EMAIL, process.env.LEDGERLY_QA_USER_B_PASSWORD);
  const org = async (client, slug) => { const r = await client.from("organizations").select("id").eq("slug", slug).single(); if (r.error) throw r.error; return r.data; };
  const orgA = await org(a, "ledgerly-qa-company-a"), orgB = await org(b, "ledgerly-qa-company-b");
  const account = async (client, organizationId, key) => { const r = await client.from("accounts").select("id,account_type").eq("organization_id", organizationId).eq("system_key", key).single(); if (r.error) throw r.error; return r.data; };
  const tax = async (client, organizationId) => { const r = await client.from("tax_rates").select("id").eq("organization_id", organizationId).eq("code", "VAT5").single(); if (r.error) throw r.error; return r.data.id; };
  const cash = await account(a, orgA.id, "cash_on_hand"), control = await account(a, orgA.id, cfg.control), invalid = await account(a, orgA.id, cfg.offset);
  ok(["cash", "bank"].includes(cash.account_type), "Selected settlement account is cash or bank");
  const createParty = async (client, organizationId, name) => { const r = await rpc(client, cfg.partyRpc, { p_organization_id: organizationId, p_name: name }); if (r.error) throw r.error; return r.data; };
  const createSource = async (client, organizationId, partyId, net, name) => {
    const line = receipt ? { description: `${run} sale`, quantity: "1", unit_price: String(net), discount: "0", tax_rate_id: await tax(client, organizationId), revenue_account_id: (await account(client, organizationId, cfg.offset)).id } : { description: `${run} purchase`, quantity: "1", unit_price: String(net), discount: "0", tax_rate_id: await tax(client, organizationId), expense_account_id: (await account(client, organizationId, cfg.offset)).id };
    const draft = await rpc(client, cfg.sourceRpc, cfg.sourceArgs(organizationId, partyId, line, `${run}-${name}`, today)); if (draft.error) throw draft.error;
    const posted = await rpc(client, cfg.postSource, { p_organization_id: organizationId, [cfg.sourceId]: draft.data }); if (posted.error) throw posted.error;
    const row = await client.from(cfg.sourceTable).select("id,status,grand_total,posted_journal_id").eq("id", draft.data).single(); if (row.error) throw row.error;
    const open = await client.from("open_items").select("id,kind,original_amount,remaining_amount,status,source_document_id").eq("source_document_id", draft.data).single(); if (open.error) throw open.error;
    ok(row.data.status === "posted" && row.data.posted_journal_id && same(row.data.grand_total, net * 1.05) && open.data.kind === (receipt ? "receivable" : "payable"), `${name} source is posted with its open item`);
    return { row: row.data, open: open.data };
  };
  const createDraft = (partyId, total, name, cashId = cash.id) => rpc(a, cfg.create, cfg.draftArgs(orgA.id, partyId, today, cashId, total, `${run}-${name}`));
  const readOpen = async (id) => { const r = await a.from("open_items").select("id,original_amount,remaining_amount,status").eq("id", id).single(); if (r.error) throw r.error; return r.data; };
  const count = async (table, field, id) => { const r = await a.from(table).select("id", { count: "exact", head: true }).eq(field, id); if (r.error) throw r.error; return r.count; };
  const assertRejected = async (name, settlementId, allocations, watched) => {
    const before = await Promise.all(watched.map(readOpen)), journals = await count("journal_entries", "source_id", settlementId), allocs = await count("open_item_allocations", cfg.allocation, settlementId);
    const post = await rpc(a, cfg.post, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlementId, p_allocations: allocations });
    ok(post.error, `${name} denied`);
    const doc = await a.from(cfg.table).select("status,posted_journal_id").eq("id", settlementId).single(); if (doc.error) throw doc.error;
    const after = await Promise.all(watched.map(readOpen));
    ok(doc.data.status === "draft" && !doc.data.posted_journal_id && (await count("journal_entries", "source_id", settlementId)) === journals && (await count("open_item_allocations", cfg.allocation, settlementId)) === allocs && after.every((x, i) => same(x.remaining_amount, before[i].remaining_amount)), `${name} is atomic: no journal, allocation, posting, or balance change`);
    const removed = await rpc(a, cfg.remove, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlementId }); ok(!removed.error, `${name} draft cleanup`);
  };
  const deny = async (name, total, allocations, watched) => { const draft = await createDraft(mainParty, total, `deny-${name}`); ok(!draft.error, `${name} draft created`); await assertRejected(name, draft.data, allocations, watched); };

  const mainParty = await createParty(a, orgA.id, `${run} primary`), source = await createSource(a, orgA.id, mainParty, cfg.primaryNet, "primary");
  ok(same(source.open.original_amount, cfg.primaryTotal) && same(source.open.remaining_amount, cfg.primaryTotal) && source.open.status === "open", "Primary source has expected original and remaining open amount before settlement");
  const settlement = await createDraft(mainParty, cfg.paid, "primary"); ok(!settlement.error, `${label} draft created`);
  const post = await rpc(a, cfg.post, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlement.data, p_allocations: [{ open_item_id: source.open.id, amount: cfg.paid }] }); if (post.error) throw post.error; ok(!post.data.already_posted, `${label} posts`);
  const document = await a.from(cfg.table).select(`status,${cfg.number},posted_journal_id`).eq("id", settlement.data).single(); if (document.error) throw document.error;
  const journal = await a.from("journal_lines").select("account_id,debit_amount,credit_amount").eq("journal_entry_id", document.data.posted_journal_id); if (journal.error) throw journal.error;
  const cashLine = journal.data.find((x) => x.account_id === cash.id), controlLine = journal.data.find((x) => x.account_id === control.id);
  ok(document.data.status === "posted" && document.data[cfg.number] && document.data.posted_journal_id, `${label} receives a number and posted journal`);
  ok(receipt ? same(cashLine?.debit_amount, cfg.paid) && same(controlLine?.credit_amount, cfg.paid) : same(controlLine?.debit_amount, cfg.paid) && same(cashLine?.credit_amount, cfg.paid), `${label} journal has exact cash/control accounting effect`);
  ok(same(journal.data.reduce((s, x) => s + n(x.debit_amount), 0), cfg.paid) && same(journal.data.reduce((s, x) => s + n(x.credit_amount), 0), cfg.paid), `${label} journal balances exactly`);
  const allocations = await a.from("open_item_allocations").select("id,open_item_id,amount").eq(cfg.allocation, settlement.data); if (allocations.error) throw allocations.error;
  const after = await readOpen(source.open.id);
  ok(allocations.data.length === 1 && allocations.data[0].open_item_id === source.open.id && same(allocations.data[0].amount, cfg.paid), `${label} has one exact allocation`);
  ok(same(after.original_amount, cfg.primaryTotal) && same(after.remaining_amount, cfg.remaining) && after.status === "partial" && n(after.remaining_amount) >= 0, `${label} open item is partial with exact remaining amount`);
  const replay = await rpc(a, cfg.post, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlement.data, p_allocations: [{ open_item_id: source.open.id, amount: cfg.paid }] });
  ok(!replay.error && replay.data.already_posted && replay.data.journal_id === document.data.posted_journal_id && (await count("journal_entries", "source_id", settlement.data)) === 1 && (await count("open_item_allocations", cfg.allocation, settlement.data)) === 1 && same((await readOpen(source.open.id)).remaining_amount, cfg.remaining), `${label} idempotency prevents a second number, journal, allocation, and reduction`);

  const multiA = await createSource(a, orgA.id, mainParty, 200, "multi-a"), multiB = await createSource(a, orgA.id, mainParty, 200, "multi-b"), multi = await createDraft(mainParty, 300, "multi");
  ok(!multi.error, `${label} multi-source draft created`); const multiPost = await rpc(a, cfg.post, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: multi.data, p_allocations: [{ open_item_id: multiA.open.id, amount: 100 }, { open_item_id: multiB.open.id, amount: 200 }] }); ok(!multiPost.error, `${label} multi-source posts`);
  const multiAlloc = await a.from("open_item_allocations").select("amount").eq(cfg.allocation, multi.data); if (multiAlloc.error) throw multiAlloc.error;
  ok(multiAlloc.data.length === 2 && same(multiAlloc.data.reduce((s, x) => s + n(x.amount), 0), 300) && same((await readOpen(multiA.open.id)).remaining_amount, 110) && same((await readOpen(multiB.open.id)).remaining_amount, 10) && same((await readOpen(source.open.id)).remaining_amount, cfg.remaining) && (await count("journal_entries", "source_id", multi.data)) === 1, `${label} multi-${receipt ? "invoice" : "bill"} allocation reduces only intended items with one journal`);

  if (!receipt) {
    const settledSource = await createSource(a, orgA.id, mainParty, 100, "fully-settled");
    const settledPayment = await createDraft(mainParty, 105, "fully-settled");
    ok(!settledPayment.error, "Supplier Payment fully-settled draft created");
    const settledPost = await rpc(a, cfg.post, { p_organization_id: orgA.id, p_payment_id: settledPayment.data, p_allocations: [{ open_item_id: settledSource.open.id, amount: 105 }] });
    ok(!settledPost.error && (await readOpen(settledSource.open.id)).status === "settled" && same((await readOpen(settledSource.open.id)).remaining_amount, 0), "Supplier Payment full allocation marks the AP open item settled at zero");
  }

  const otherParty = await createParty(a, orgA.id, `${run} other`), other = await createSource(a, orgA.id, otherParty, cfg.primaryNet, "other-party");
  const foreignParty = await createParty(b, orgB.id, `${run} foreign`), foreign = await createSource(b, orgB.id, foreignParty, cfg.primaryNet, "foreign");
  await deny("allocation below settlement amount", 100, [{ open_item_id: source.open.id, amount: 99 }], [source.open.id]);
  await deny("allocation above settlement amount", 100, [{ open_item_id: source.open.id, amount: 101 }], [source.open.id]);
  await deny("allocation above open-item remaining", cfg.remaining + 1, [{ open_item_id: source.open.id, amount: cfg.remaining + 1 }], [source.open.id]);
  await deny("duplicate allocation target", 100, [{ open_item_id: source.open.id, amount: 50 }, { open_item_id: source.open.id, amount: 50 }], [source.open.id]);
  await deny("missing allocation target", 100, [{ amount: 100 }], [source.open.id]); await deny("zero allocation", 100, [{ open_item_id: source.open.id, amount: 0 }], [source.open.id]); await deny("negative allocation", 100, [{ open_item_id: source.open.id, amount: -1 }], [source.open.id]);
  await deny(`wrong ${receipt ? "customer" : "supplier"} target`, 100, [{ open_item_id: other.open.id, amount: 100 }], [source.open.id, other.open.id]); await deny("cross-tenant target", 100, [{ open_item_id: foreign.open.id, amount: 100 }], [source.open.id]);
  const beforeInvalid = await a.from(cfg.table).select("id", { count: "exact", head: true }).eq("organization_id", orgA.id), invalidDraft = await createDraft(mainParty, 100, "invalid-cash", invalid.id), afterInvalid = await a.from(cfg.table).select("id", { count: "exact", head: true }).eq("organization_id", orgA.id);
  ok(invalidDraft.error && beforeInvalid.count === afterInvalid.count, "Invalid non-cash-bank account is denied without a document orphan");
  const anonymous = await anon.rpc(cfg.post, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlement.data, p_allocations: [{ open_item_id: source.open.id, amount: cfg.paid }] }); ok(anonymous.error, "Anonymous posting denied");
  const updateArgs = receipt ? { p_organization_id: orgA.id, p_receipt_id: settlement.data, p_customer_id: mainParty, p_receipt_date: today, p_cash_account_id: cash.id, p_amount: cfg.paid } : { p_organization_id: orgA.id, p_payment_id: settlement.data, p_supplier_id: mainParty, p_payment_date: today, p_cash_account_id: cash.id, p_amount: cfg.paid };
  ok((await rpc(a, cfg.update, updateArgs)).error && (await rpc(a, cfg.remove, { p_organization_id: orgA.id, [cfg.id === "receipt_id" ? "p_receipt_id" : "p_payment_id"]: settlement.data })).error, `Posted ${label.toLowerCase()} is immutable through draft RPCs`);
  const direct = async (table, id, patch, field, expected) => { const write = await a.from(table).update(patch).eq("id", id).select(field); const read = await a.from(table).select(field).eq("id", id).single(); if (read.error) throw read.error; ok(write.error || !write.data?.length || String(read.data[field]) === String(expected), `Direct ${table} mutation denied or unavailable`); };
  await direct("open_item_allocations", allocations.data[0].id, { amount: cfg.paid - 1 }, "amount", cfg.paid); await direct("open_items", source.open.id, { remaining_amount: 1 }, "remaining_amount", cfg.remaining); await direct(cfg.table, settlement.data, { posted_journal_id: null }, "posted_journal_id", document.data.posted_journal_id);
  console.log(`${label} integration QA complete. Posted QA records are immutable and isolated by ${run}; only rejected synthetic drafts are cleaned up.`);
}
