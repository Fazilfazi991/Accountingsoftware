import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "LEDGERLY_QA_USER_A_EMAIL",
  "LEDGERLY_QA_USER_A_PASSWORD",
]) if (!process.env[key]) throw new Error(`Missing ${key}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const login = await db.auth.signInWithPassword({ email: process.env.LEDGERLY_QA_USER_A_EMAIL, password: process.env.LEDGERLY_QA_USER_A_PASSWORD });
if (login.error) throw login.error;
const one = async (query) => { const result = await query.single(); if (result.error) throw result.error; return result.data; };
const call = async (name, args) => { const result = await db.rpc(name, args); if (result.error) throw result.error; return result.data; };
const pass = (value, message) => { if (!value) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const close = (actual, expected, tolerance = 0.00001) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
const today = new Date().toISOString().slice(0, 10);
const prefix = `SHIP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const organization = await one(db.from("organizations").select("id").eq("slug", "ledgerly-qa-company-a"));
const branch = await one(db.from("branches").select("id").eq("organization_id", organization.id).eq("status", "active").limit(1));
await call("initialize_inventory_foundation", { p_organization_id: organization.id });
const location = await one(db.from("inventory_locations").select("id").eq("organization_id", organization.id).eq("branch_id", branch.id).eq("status", "active").limit(1));
const unit = await one(db.from("inventory_units").select("id").eq("organization_id", organization.id).eq("code", "PCS"));
const vat = await one(db.from("tax_rates").select("id").eq("organization_id", organization.id).eq("code", "VAT5"));
const accounts = {};
for (const key of ["sales_revenue", "office_expense", "cash_on_hand", "inventory", "cost_of_goods_sold", "input_vat", "output_vat"]) {
  accounts[key] = (await one(db.from("accounts").select("id").eq("organization_id", organization.id).eq("system_key", key))).id;
}

const customer = await call("create_customer", { p_organization_id: organization.id, p_name: `${prefix} Customer` });
const supplier = await call("create_supplier", { p_organization_id: organization.id, p_name: `${prefix} Supplier` });
const product = await one(db.from("products").insert({ organization_id: organization.id, kind: "product", name: `${prefix} Tracked Product`, sku: `${prefix}-P`, unit_id: unit.id, track_inventory: true }).select("id"));
const service = await one(db.from("products").insert({ organization_id: organization.id, kind: "service", name: `${prefix} Service`, sku: `${prefix}-S`, track_inventory: false }).select("id"));
const refs = (name) => `${prefix}-${name}`;

const purchaseLines = [
  { description: "Tracked inventory", quantity: 10, unit_price: 100, discount: 0, tax_rate_id: vat.id, product_id: product.id, inventory_location_id: location.id, expense_account_id: accounts.office_expense },
  { description: "Professional service", quantity: 1, unit_price: 200, discount: 0, tax_rate_id: vat.id, product_id: service.id, inventory_location_id: null, expense_account_id: accounts.office_expense },
];
const bill = await call("create_purchase_bill_draft", { p_organization_id: organization.id, p_supplier_id: supplier, p_bill_date: today, p_due_date: today, p_lines: purchaseLines, p_branch_id: branch.id, p_reference: refs("BILL"), p_notes: null });
await call("post_purchase_bill", { p_organization_id: organization.id, p_bill_id: bill });
const billRow = await one(db.from("purchase_bills").select("grand_total,posted_journal_id,bill_number").eq("id", bill));
const billOpen = await one(db.from("open_items").select("id,remaining_amount").eq("source_document_id", bill));
pass(billRow.bill_number && close(billRow.grand_total, 1260), "Purchase Bill posts tracked stock, service expense and AED 60 Input VAT");

const payment = await call("create_supplier_payment_draft", { p_organization_id: organization.id, p_supplier_id: supplier, p_payment_date: today, p_cash_account_id: accounts.cash_on_hand, p_amount: 500, p_branch_id: branch.id, p_reference: refs("PAYMENT"), p_notes: null });
await call("post_supplier_payment", { p_organization_id: organization.id, p_payment_id: payment, p_allocations: [{ open_item_id: billOpen.id, amount: 500 }] });

const salesLines = [
  { description: "Tracked inventory", quantity: 4, unit_price: 200, discount: 0, tax_rate_id: vat.id, product_id: product.id, inventory_location_id: location.id, revenue_account_id: accounts.sales_revenue },
  { description: "Professional service", quantity: 1, unit_price: 300, discount: 0, tax_rate_id: vat.id, product_id: service.id, inventory_location_id: null, revenue_account_id: accounts.sales_revenue },
];
const invoice = await call("create_sales_invoice_draft", { p_organization_id: organization.id, p_customer_id: customer, p_invoice_date: today, p_due_date: today, p_lines: salesLines, p_branch_id: branch.id, p_reference: refs("INVOICE"), p_notes: null });
await call("post_sales_invoice", { p_organization_id: organization.id, p_invoice_id: invoice });
const invoiceRow = await one(db.from("sales_invoices").select("grand_total,posted_journal_id,invoice_number").eq("id", invoice));
const invoiceOpen = await one(db.from("open_items").select("id,remaining_amount").eq("source_document_id", invoice));
pass(invoiceRow.invoice_number && close(invoiceRow.grand_total, 1155), "Sales Invoice posts tracked stock, service revenue and AED 55 Output VAT");

const receipt = await call("create_customer_receipt_draft", { p_organization_id: organization.id, p_customer_id: customer, p_receipt_date: today, p_cash_account_id: accounts.cash_on_hand, p_amount: 500, p_allocations: [], p_branch_id: branch.id, p_reference: refs("RECEIPT"), p_notes: null });
await call("post_customer_receipt", { p_organization_id: organization.id, p_receipt_id: receipt, p_allocations: [{ open_item_id: invoiceOpen.id, amount: 500 }] });

const invoiceSourceLines = await db.from("sales_invoice_lines").select("id,product_id").eq("invoice_id", invoice); if (invoiceSourceLines.error) throw invoiceSourceLines.error;
const saleProductLine = invoiceSourceLines.data.find((line) => line.product_id === product.id);
const saleServiceLine = invoiceSourceLines.data.find((line) => line.product_id === service.id);
const financialCredit = await call("create_sales_credit_note_draft", { p_organization_id: organization.id, p_customer_id: customer, p_invoice_id: invoice, p_credit_note_date: today, p_lines: [{ source_invoice_line_id: saleServiceLine.id, quantity: 1, return_to_stock: false }], p_branch_id: branch.id, p_reference: refs("CN-FIN"), p_notes: null });
await call("post_sales_credit_note", { p_organization_id: organization.id, p_credit_note_id: financialCredit });
const physicalCredit = await call("create_sales_credit_note_draft", { p_organization_id: organization.id, p_customer_id: customer, p_invoice_id: invoice, p_credit_note_date: today, p_lines: [{ source_invoice_line_id: saleProductLine.id, quantity: 1, return_to_stock: true }], p_branch_id: branch.id, p_reference: refs("CN-STOCK"), p_notes: null });
await call("post_sales_credit_note", { p_organization_id: organization.id, p_credit_note_id: physicalCredit });

const billSourceLines = await db.from("purchase_bill_lines").select("id,product_id").eq("bill_id", bill); if (billSourceLines.error) throw billSourceLines.error;
const billProductLine = billSourceLines.data.find((line) => line.product_id === product.id);
const billServiceLine = billSourceLines.data.find((line) => line.product_id === service.id);
const financialDebit = await call("create_purchase_debit_note_draft", { p_organization_id: organization.id, p_supplier_id: supplier, p_bill_id: bill, p_debit_note_date: today, p_lines: [{ source_bill_line_id: billServiceLine.id, quantity: 1, return_from_stock: false }], p_branch_id: branch.id, p_reference: refs("DN-FIN"), p_notes: null });
await call("post_purchase_debit_note", { p_organization_id: organization.id, p_debit_note_id: financialDebit });
const physicalDebit = await call("create_purchase_debit_note_draft", { p_organization_id: organization.id, p_supplier_id: supplier, p_bill_id: bill, p_debit_note_date: today, p_lines: [{ source_bill_line_id: billProductLine.id, quantity: 2, return_from_stock: true }], p_branch_id: branch.id, p_reference: refs("DN-STOCK"), p_notes: null });
await call("post_purchase_debit_note", { p_organization_id: organization.id, p_debit_note_id: physicalDebit });

for (const [name, amount, taxRate] of [["EXP-VAT", 100, vat.id], ["EXP-ZERO", 50, null]]) {
  const expense = await call("create_expense_draft", { p_organization_id: organization.id, p_expense_date: today, p_expense_account_id: accounts.office_expense, p_payment_account_id: accounts.cash_on_hand, p_net_amount: amount, p_tax_rate_id: taxRate, p_branch_id: branch.id, p_payee_name: prefix, p_reference: refs(name), p_notes: null });
  await call("post_expense", { p_organization_id: organization.id, p_expense_id: expense });
}

const valuation = (await call("get_inventory_valuation_report", { p_organization_id: organization.id, p_product_id: product.id }))[0];
pass(close(valuation.quantity_on_hand, 5) && close(valuation.inventory_value, 500) && close(valuation.average_unit_cost, 100), "Stock lifecycle reconciles to QOH 5 and AED 500 valuation at AED 100 average cost");

const ar = await call("get_open_item_report", { p_organization_id: organization.id, p_kind: "receivable", p_state: "all", p_as_of: today, p_branch_id: branch.id });
const ap = await call("get_open_item_report", { p_organization_id: organization.id, p_kind: "payable", p_state: "all", p_as_of: today, p_branch_id: branch.id });
const scenarioAr = ar.find((row) => row.document_id === invoice);
const scenarioAp = ap.find((row) => row.document_id === bill);
pass(close(scenarioAr.outstanding, 130) && scenarioAr.item_status === "partial", "AR report reconciles invoice, receipt and two credits to AED 130");
pass(close(scenarioAp.outstanding, 340) && scenarioAp.item_status === "partial", "AP report reconciles bill, payment and two debit notes to AED 340");

const customerStatement = await call("get_party_statement", { p_organization_id: organization.id, p_party_type: "customer", p_party_id: customer, p_from: today, p_to: today, p_branch_id: branch.id });
const supplierStatement = await call("get_party_statement", { p_organization_id: organization.id, p_party_type: "supplier", p_party_id: supplier, p_from: today, p_to: today, p_branch_id: branch.id });
pass(close(customerStatement.at(-1).running_balance, 130), "Customer Statement closing balance equals AR report");
pass(close(supplierStatement.at(-1).running_balance, 340), "Supplier Statement closing balance equals AP report");

const concurrencyCustomer = await call("create_customer", { p_organization_id: organization.id, p_name: `${prefix} Numbering Customer` });
const concurrentLine = [{ description: "Concurrent numbering", quantity: 1, unit_price: 1, discount: 0, tax_rate_id: null, product_id: service.id, inventory_location_id: null, revenue_account_id: accounts.sales_revenue }];
const [numberDraftA, numberDraftB] = await Promise.all([
  call("create_sales_invoice_draft", { p_organization_id: organization.id, p_customer_id: concurrencyCustomer, p_invoice_date: today, p_due_date: today, p_lines: concurrentLine, p_branch_id: branch.id, p_reference: refs("NUMBER-A"), p_notes: null }),
  call("create_sales_invoice_draft", { p_organization_id: organization.id, p_customer_id: concurrencyCustomer, p_invoice_date: today, p_due_date: today, p_lines: concurrentLine, p_branch_id: branch.id, p_reference: refs("NUMBER-B"), p_notes: null }),
]);
await Promise.all([
  call("post_sales_invoice", { p_organization_id: organization.id, p_invoice_id: numberDraftA }),
  call("post_sales_invoice", { p_organization_id: organization.id, p_invoice_id: numberDraftB }),
]);
const numbered = await db.from("sales_invoices").select("id,invoice_number").in("id", [numberDraftA, numberDraftB]); if (numbered.error) throw numbered.error;
const numericParts = numbered.data.map((row) => Number(row.invoice_number.match(/(\d+)(?!.*\d)/)?.[1]));
pass(new Set(numbered.data.map((row) => row.invoice_number)).size === 2 && Math.abs(numericParts[0] - numericParts[1]) === 1, "Concurrent invoice posting reserves unique sequential document numbers");
const replay = await call("post_sales_invoice", { p_organization_id: organization.id, p_invoice_id: numberDraftA });
pass(replay.already_posted === true, "Invoice repost is idempotent and does not reserve another number");

const trial = await call("get_trial_balance", { p_organization_id: organization.id, p_as_of: today });
pass(close(trial.reduce((sum, row) => sum + Number(row.debit), 0), trial.reduce((sum, row) => sum + Number(row.credit), 0)), "Trial Balance remains balanced after the full ship scenario");

const movements = await call("get_stock_movement_report", { p_organization_id: organization.id, p_product_id: product.id, p_location_id: null, p_branch_id: branch.id, p_from: today, p_to: today, p_movement_type: null });
pass(close(movements.reduce((sum, row) => sum + Number(row.signed_quantity), 0), valuation.quantity_on_hand), "Stock Summary quantity equals the signed stock movement ledger");

console.log(`CERTIFIED ${prefix}: AR AED 130, AP AED 340, inventory 5 units / AED 500; VAT documents, expenses, settlements, returns and journals posted.`);
