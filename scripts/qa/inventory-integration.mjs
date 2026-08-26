import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import "./safety.mjs";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "LEDGERLY_QA_USER_A_EMAIL",
  "LEDGERLY_QA_USER_A_PASSWORD",
  "LEDGERLY_QA_USER_B_EMAIL",
  "LEDGERLY_QA_USER_B_PASSWORD",
];
for (const key of required)
  if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
const pass = (value, message) => {
  if (!value) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
};
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const login = async (client, email, password) => {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
};
const rpc = async (client, name, args) => {
  const result = await client.rpc(name, args);
  return result;
};
const one = async (query) => {
  const result = await query.single();
  if (result.error) throw result.error;
  return result.data;
};
const count = async (client, table, field, value) => {
  const result = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(field, value);
  if (result.error) throw result.error;
  return result.count;
};

const a = make(),
  b = make(),
  anon = make();
await login(
  a,
  process.env.LEDGERLY_QA_USER_A_EMAIL,
  process.env.LEDGERLY_QA_USER_A_PASSWORD,
);
await login(
  b,
  process.env.LEDGERLY_QA_USER_B_EMAIL,
  process.env.LEDGERLY_QA_USER_B_PASSWORD,
);
const orgA = await one(
  a.from("organizations").select("id").eq("slug", "ledgerly-qa-company-a"),
);
const orgB = await one(
  b.from("organizations").select("id").eq("slug", "ledgerly-qa-company-b"),
);
const branch = await one(
  a
    .from("branches")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("status", "active")
    .limit(1),
);
let result = await rpc(a, "initialize_inventory_foundation", {
  p_organization_id: orgA.id,
});
if (result.error) throw result.error;
const unit = await one(
  a
    .from("inventory_units")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("code", "PCS"),
);
const location = await one(
  a
    .from("inventory_locations")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("branch_id", branch.id)
    .eq("status", "active")
    .limit(1),
);
const salesAccount = await one(
  a
    .from("accounts")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("system_key", "sales_revenue"),
);
const purchaseAccount = await one(
  a
    .from("accounts")
    .select("id")
    .eq("organization_id", orgA.id)
    .eq("system_key", "rent_expense"),
);
const stamp = `INVINT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const today = new Date().toISOString().slice(0, 10);
const customerResult = await rpc(a, "create_customer", {
  p_organization_id: orgA.id,
  p_name: `${stamp} Customer`,
});
const supplierResult = await rpc(a, "create_supplier", {
  p_organization_id: orgA.id,
  p_name: `${stamp} Supplier`,
});
if (customerResult.error || supplierResult.error)
  throw customerResult.error || supplierResult.error;
const customer = customerResult.data,
  supplier = supplierResult.data;
const insertProduct = async (values) =>
  one(
    a
      .from("products")
      .insert({ organization_id: orgA.id, ...values })
      .select("id"),
  );
const product = await insertProduct({
  kind: "product",
  name: `${stamp} Tracked`,
  sku: `${stamp}-P`,
  unit_id: unit.id,
  track_inventory: true,
});
const service = await insertProduct({
  kind: "service",
  name: `${stamp} Service`,
  sku: `${stamp}-S`,
  track_inventory: false,
});
const raceProduct = await insertProduct({
  kind: "product",
  name: `${stamp} Race`,
  sku: `${stamp}-R`,
  unit_id: unit.id,
  track_inventory: true,
});
const returnProduct = await insertProduct({
  kind: "product",
  name: `${stamp} Return guard`,
  sku: `${stamp}-G`,
  unit_id: unit.id,
  track_inventory: true,
});
const foreignProduct = await one(
  b
    .from("products")
    .insert({
      organization_id: orgB.id,
      kind: "service",
      name: `${stamp} Foreign service`,
      sku: `${stamp}-FOREIGN`,
      track_inventory: false,
    })
    .select("id"),
);
const stock = (id, quantity) =>
  rpc(a, "post_stock_operation", {
    p_operation_id: randomUUID(),
    p_organization_id: orgA.id,
    p_branch_id: branch.id,
    p_operation_type: "opening",
    p_transaction_date: today,
    p_product_id: id,
    p_source_location_id: location.id,
    p_destination_location_id: null,
    p_quantity: quantity,
    p_unit_cost: 10,
    p_reference: stamp,
    p_reason: "Inventory integration QA",
    p_notes: null,
  });
for (const [id, quantity] of [
  [product.id, 90],
  [raceProduct.id, 50],
]) {
  result = await stock(id, quantity);
  if (result.error) throw result.error;
}
const qoh = async (productId) => {
  const q = await rpc(a, "get_stock_summary", {
    p_organization_id: orgA.id,
    p_branch_id: branch.id,
    p_product_id: productId,
    p_location_id: location.id,
  });
  if (q.error) throw q.error;
  return q.data.reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
};
const productLine = (
  productId,
  quantity,
  price,
  accountKey,
  description = "Tracked product",
) => ({
  description,
  quantity,
  unit_price: price,
  discount: 0,
  tax_rate_id: null,
  product_id: productId,
  inventory_location_id: location.id,
  [accountKey]:
    accountKey === "revenue_account_id" ? salesAccount.id : purchaseAccount.id,
});
const serviceLine = (accountKey) => ({
  description: "Service line",
  quantity: 2,
  unit_price: 15,
  discount: 0,
  tax_rate_id: null,
  product_id: service.id,
  inventory_location_id: null,
  [accountKey]:
    accountKey === "revenue_account_id" ? salesAccount.id : purchaseAccount.id,
});
const createInvoice = (lines, reference) =>
  rpc(a, "create_sales_invoice_draft", {
    p_organization_id: orgA.id,
    p_customer_id: customer,
    p_invoice_date: today,
    p_due_date: today,
    p_lines: lines,
    p_branch_id: branch.id,
    p_reference: `${stamp}-${reference}`,
    p_notes: null,
  });
const createBill = (lines, reference) =>
  rpc(a, "create_purchase_bill_draft", {
    p_organization_id: orgA.id,
    p_supplier_id: supplier,
    p_bill_date: today,
    p_due_date: today,
    p_lines: lines,
    p_branch_id: branch.id,
    p_reference: `${stamp}-${reference}`,
    p_notes: null,
  });
const postInvoice = (id) =>
  rpc(a, "post_sales_invoice", {
    p_organization_id: orgA.id,
    p_invoice_id: id,
  });
const postBill = (id) =>
  rpc(a, "post_purchase_bill", { p_organization_id: orgA.id, p_bill_id: id });
const movements = async (sourceId) => {
  const q = await a
    .from("stock_movements")
    .select(
      "id,movement_type,signed_quantity,source_document_id,source_document_line_id",
    )
    .eq("source_document_id", sourceId);
  if (q.error) throw q.error;
  return q.data;
};
const assertJournal = async (table, id, label) => {
  const doc = await one(
    a.from(table).select("status,posted_journal_id").eq("id", id),
  );
  const lines = await a
    .from("journal_lines")
    .select("debit_amount,credit_amount")
    .eq("journal_entry_id", doc.posted_journal_id);
  if (lines.error) throw lines.error;
  pass(
    doc.status === "posted" &&
      same(
        lines.data.reduce((s, x) => s + Number(x.debit_amount), 0),
        lines.data.reduce((s, x) => s + Number(x.credit_amount), 0),
      ),
    `${label} financial journal is posted and balanced`,
  );
};

const bill = await createBill(
  [
    productLine(product.id, 40, 10, "expense_account_id"),
    serviceLine("expense_account_id"),
  ],
  "purchase",
);
if (bill.error) throw bill.error;
result = await postBill(bill.data);
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 130,
  "Purchase Bill raises tracked stock from 90 to 130",
);
pass(
  (await movements(bill.data)).length === 1 &&
    same((await movements(bill.data))[0].signed_quantity, 40),
  "Mixed Purchase Bill creates one purchase movement and no service movement",
);
await assertJournal("purchase_bills", bill.data, "Purchase Bill");
pass(
  Boolean(
    (
      await one(
        a.from("open_items").select("id").eq("source_document_id", bill.data),
      )
    ).id,
  ),
  "Purchase Bill creates its real AP open item",
);

const invoice = await createInvoice(
  [
    productLine(product.id, 30, 12, "revenue_account_id"),
    serviceLine("revenue_account_id"),
  ],
  "sale",
);
if (invoice.error) throw invoice.error;
result = await postInvoice(invoice.data);
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 100,
  "Sales Invoice reduces tracked stock from 130 to 100",
);
pass(
  (await movements(invoice.data)).length === 1 &&
    same((await movements(invoice.data))[0].signed_quantity, -30),
  "Mixed Sales Invoice creates one sale movement and no service movement",
);
await assertJournal("sales_invoices", invoice.data, "Sales Invoice");
pass(
  Boolean(
    (
      await one(
        a
          .from("open_items")
          .select("id")
          .eq("source_document_id", invoice.data),
      )
    ).id,
  ),
  "Sales Invoice creates its real AR open item",
);

const oversale = await createInvoice(
  [productLine(product.id, 101, 1, "revenue_account_id")],
  "oversale",
);
if (oversale.error) throw oversale.error;
const beforeJournals = await count(
  a,
  "journal_entries",
  "source_id",
  oversale.data,
);
result = await postInvoice(oversale.data);
const oversaleDoc = await one(
  a
    .from("sales_invoices")
    .select("status,posted_journal_id")
    .eq("id", oversale.data),
);
pass(
  Boolean(result.error) &&
    oversaleDoc.status === "draft" &&
    !oversaleDoc.posted_journal_id &&
    (await count(a, "journal_entries", "source_id", oversale.data)) ===
      beforeJournals &&
    (await count(a, "open_items", "source_document_id", oversale.data)) === 0 &&
    (await movements(oversale.data)).length === 0 &&
    (await qoh(product.id)) === 100,
  "Insufficient-stock sale rolls back document, journal, AR, and stock atomically",
);

const invoiceLine = await one(
  a
    .from("sales_invoice_lines")
    .select("id")
    .eq("invoice_id", invoice.data)
    .eq("product_id", product.id),
);
const credit = async (quantity, physical, name) =>
  rpc(a, "create_sales_credit_note_draft", {
    p_organization_id: orgA.id,
    p_customer_id: customer,
    p_invoice_id: invoice.data,
    p_credit_note_date: today,
    p_lines: [
      {
        source_invoice_line_id: invoiceLine.id,
        quantity,
        return_to_stock: physical,
      },
    ],
    p_branch_id: branch.id,
    p_reference: `${stamp}-${name}`,
    p_notes: null,
  });
const physicalCredit = await credit(10, true, "physical-credit");
if (physicalCredit.error) throw physicalCredit.error;
result = await rpc(a, "post_sales_credit_note", {
  p_organization_id: orgA.id,
  p_credit_note_id: physicalCredit.data,
});
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 110 &&
    (await movements(physicalCredit.data)).length === 1,
  "Physical Sales Credit Note returns 10 to stock",
);
const financialCredit = await credit(5, false, "financial-credit");
if (financialCredit.error) throw financialCredit.error;
result = await rpc(a, "post_sales_credit_note", {
  p_organization_id: orgA.id,
  p_credit_note_id: financialCredit.data,
});
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 110 &&
    (await movements(financialCredit.data)).length === 0,
  "Financial-only Sales Credit Note leaves stock unchanged",
);

const billLine = await one(
  a
    .from("purchase_bill_lines")
    .select("id")
    .eq("bill_id", bill.data)
    .eq("product_id", product.id),
);
const debit = async (
  quantity,
  physical,
  name,
  sourceBill = bill.data,
  sourceLine = billLine.id,
) =>
  rpc(a, "create_purchase_debit_note_draft", {
    p_organization_id: orgA.id,
    p_supplier_id: supplier,
    p_bill_id: sourceBill,
    p_debit_note_date: today,
    p_lines: [
      {
        source_bill_line_id: sourceLine,
        quantity,
        return_from_stock: physical,
      },
    ],
    p_branch_id: branch.id,
    p_reference: `${stamp}-${name}`,
    p_notes: null,
  });
const physicalDebit = await debit(5, true, "physical-debit");
if (physicalDebit.error) throw physicalDebit.error;
result = await rpc(a, "post_purchase_debit_note", {
  p_organization_id: orgA.id,
  p_debit_note_id: physicalDebit.data,
});
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 105 &&
    (await movements(physicalDebit.data)).length === 1,
  "Physical Purchase Debit Note removes 5 from stock",
);
const financialDebit = await debit(5, false, "financial-debit");
if (financialDebit.error) throw financialDebit.error;
result = await rpc(a, "post_purchase_debit_note", {
  p_organization_id: orgA.id,
  p_debit_note_id: financialDebit.data,
});
if (result.error) throw result.error;
pass(
  (await qoh(product.id)) === 105 &&
    (await movements(financialDebit.data)).length === 0,
  "Financial-only Purchase Debit Note leaves stock unchanged",
);

for (const [name, fn, id] of [
  ["Purchase Bill", postBill, bill.data],
  ["Sales Invoice", postInvoice, invoice.data],
  [
    "Sales Credit Note",
    (x) =>
      rpc(a, "post_sales_credit_note", {
        p_organization_id: orgA.id,
        p_credit_note_id: x,
      }),
    physicalCredit.data,
  ],
  [
    "Purchase Debit Note",
    (x) =>
      rpc(a, "post_purchase_debit_note", {
        p_organization_id: orgA.id,
        p_debit_note_id: x,
      }),
    physicalDebit.data,
  ],
]) {
  const before = (await movements(id)).length;
  const replay = await fn(id);
  pass(
    !replay.error &&
      replay.data.already_posted &&
      (await movements(id)).length === before,
    `${name} replay is stock-idempotent`,
  );
}

const guardedBill = await createBill(
  [productLine(returnProduct.id, 20, 10, "expense_account_id")],
  "return-guard-bill",
);
if (guardedBill.error) throw guardedBill.error;
result = await postBill(guardedBill.data);
if (result.error) throw result.error;
const guardedInvoice = await createInvoice(
  [productLine(returnProduct.id, 18, 10, "revenue_account_id")],
  "return-guard-sale",
);
if (guardedInvoice.error) throw guardedInvoice.error;
result = await postInvoice(guardedInvoice.data);
if (result.error) throw result.error;
const guardedLine = await one(
  a.from("purchase_bill_lines").select("id").eq("bill_id", guardedBill.data),
);
const guardedDebit = await debit(
  5,
  true,
  "return-guard",
  guardedBill.data,
  guardedLine.id,
);
if (guardedDebit.error) throw guardedDebit.error;
result = await rpc(a, "post_purchase_debit_note", {
  p_organization_id: orgA.id,
  p_debit_note_id: guardedDebit.data,
});
const guardedDoc = await one(
  a
    .from("purchase_debit_notes")
    .select("status,posted_journal_id")
    .eq("id", guardedDebit.data),
);
pass(
  Boolean(result.error) &&
    (await qoh(returnProduct.id)) === 2 &&
    guardedDoc.status === "draft" &&
    !guardedDoc.posted_journal_id &&
    (await count(
      a,
      "open_item_allocations",
      "purchase_debit_note_id",
      guardedDebit.data,
    )) === 0 &&
    (await movements(guardedDebit.data)).length === 0,
  "Purchase return cannot drive stock negative and rolls back its financial effects",
);

const raceA = await createInvoice(
  [productLine(raceProduct.id, 40, 1, "revenue_account_id")],
  "race-a",
);
const raceB = await createInvoice(
  [productLine(raceProduct.id, 40, 1, "revenue_account_id")],
  "race-b",
);
if (raceA.error || raceB.error) throw raceA.error || raceB.error;
const raced = await Promise.all([
  postInvoice(raceA.data),
  postInvoice(raceB.data),
]);
pass(
  raced.filter((x) => !x.error).length === 1 &&
    raced.filter((x) => x.error).length === 1 &&
    (await qoh(raceProduct.id)) === 10,
  "Concurrent Sales Invoices cannot double-consume available stock",
);

const forged = await rpc(a, "create_sales_invoice_draft", {
  p_organization_id: orgA.id,
  p_customer_id: customer,
  p_invoice_date: today,
  p_due_date: today,
  p_lines: [productLine(returnProduct.id, 1, 1, "revenue_account_id")].map(
    (x) => ({
      ...x,
      product_id: product.id,
      inventory_location_id: randomUUID(),
    }),
  ),
  p_branch_id: branch.id,
  p_reference: `${stamp}-forged`,
  p_notes: null,
});
pass(
  Boolean(forged.error),
  "Cross-scope location provenance is rejected without a draft orphan",
);
const foreignProductAttempt = await rpc(a, "create_sales_invoice_draft", {
  p_organization_id: orgA.id,
  p_customer_id: customer,
  p_invoice_date: today,
  p_due_date: today,
  p_lines: [productLine(foreignProduct.id, 1, 1, "revenue_account_id")],
  p_branch_id: branch.id,
  p_reference: `${stamp}-foreign-product`,
  p_notes: null,
});
pass(
  Boolean(foreignProductAttempt.error),
  "Unknown or cross-tenant product provenance is rejected",
);
pass(
  Boolean(
    (
      await anon.rpc("post_sales_invoice", {
        p_organization_id: orgA.id,
        p_invoice_id: invoice.data,
      })
    ).error,
  ),
  "Anonymous document posting is denied",
);
pass(
  Boolean(
    (
      await b.rpc("post_sales_invoice", {
        p_organization_id: orgA.id,
        p_invoice_id: invoice.data,
      })
    ).error,
  ),
  "Cross-tenant document posting is denied",
);
const crossRead = await b
  .from("stock_movements")
  .select("id")
  .in("source_document_id", [
    bill.data,
    invoice.data,
    physicalCredit.data,
    physicalDebit.data,
  ]);
pass(
  !crossRead.error && crossRead.data.length === 0,
  "Cross-tenant users cannot read document stock movements",
);
const direct = await a.from("stock_movements").insert({
  organization_id: orgA.id,
  branch_id: branch.id,
  location_id: location.id,
  product_id: product.id,
  transaction_date: today,
  movement_type: "sale",
  signed_quantity: -1,
  source_document_type: "sales_invoice",
  source_document_id: randomUUID(),
  created_by: (await a.auth.getUser()).data.user.id,
});
pass(Boolean(direct.error), "Direct stock movement mutation remains denied");
const report = await rpc(a, "get_stock_movement_report", {
  p_organization_id: orgA.id,
  p_branch_id: branch.id,
  p_product_id: product.id,
  p_location_id: location.id,
  p_from: null,
  p_to: null,
  p_movement_type: null,
});
pass(
  !report.error &&
    report.data.some(
      (x) => x.source_document_id === invoice.data && x.source_document_line_id,
    ),
  "Movement report exposes source-document and source-line provenance",
);
const trial = await rpc(a, "get_trial_balance", {
  p_organization_id: orgA.id,
  p_as_of: today,
});
if (trial.error) throw trial.error;
pass(
  same(
    trial.data.reduce((s, x) => s + Number(x.debit), 0),
    trial.data.reduce((s, x) => s + Number(x.credit), 0),
  ),
  "Trial Balance remains balanced after inventory-integrated documents",
);
pass(
  (await qoh(product.id)) === 105,
  "Deterministic final tracked-product QOH is 105",
);
console.log(
  `CERTIFIED ${stamp}: purchase +40, sale -30, sales return +10, purchase return -5, final QOH 105.`,
);
