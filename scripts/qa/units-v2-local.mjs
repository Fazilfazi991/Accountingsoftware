import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.startsWith("http://127.0.0.1:") || !anonKey || !serviceKey) throw new Error("Local Supabase credentials are required.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const pass = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
async function actor(label) {
  const email = `uom-${label}@local.example`, password = "Local-Uom-12345!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  const org = await client.rpc("create_organization", { p_name: `UOM ${label}`, p_legal_name: null, p_slug: `uom-${label}`, p_branch_name: "Main" }); if (org.error) throw org.error;
  const branch = await client.from("branches").select("id").eq("organization_id", org.data).single(); if (branch.error) throw branch.error;
  for (const [name, args] of [["initialize_accounting_setup", { p_organization_id: org.data }], ["initialize_inventory_foundation", { p_organization_id: org.data }], ["ensure_default_inventory_units", { p_org: org.data }]]) { const result = await client.rpc(name, args); if (result.error) throw result.error; }
  return { client, org: org.data, branch: branch.data.id };
}
const a = await actor("a"), b = await actor("b"), date = new Date().toISOString().slice(0, 10);
const unit = async (client, org, code) => { const r = await client.from("inventory_units").select("id,code").eq("organization_id", org).eq("code", code).single(); if (r.error) throw r.error; return r.data; };
const box = await unit(a.client, a.org, "BOX"), pcs = await unit(a.client, a.org, "PCS"), bag = await unit(a.client, a.org, "BAG"), kg = await unit(a.client, a.org, "KG");
const locationResult = await a.client.from("inventory_locations").select("id").eq("organization_id", a.org).eq("branch_id", a.branch).eq("is_default", true).single(); if (locationResult.error) throw locationResult.error; const location = locationResult.data.id;
async function product(name, primary, secondary, factor, salesPrice) { const r = await a.client.from("products").insert({ organization_id:a.org,kind:"product",name,sku:`UOM-${randomUUID().slice(0,8)}`,unit_id:primary,secondary_unit_id:secondary,secondary_conversion_factor:factor,sales_price:salesPrice,purchase_price:salesPrice*.6,track_inventory:true,created_by:(await a.client.auth.getUser()).data.user.id }).select("id").single(); if(r.error)throw r.error;return r.data.id; }
const hinge = await product("QA UOM Cabinet Hinge",box.id,pcs.id,10,100), cement = await product("QA UOM White Cement",bag.id,kg.id,50,120);
async function stock(productId, type, quantity, unitId, cost=null) { const r=await a.client.rpc("post_stock_operation_uom",{p_operation_id:randomUUID(),p_organization_id:a.org,p_branch_id:a.branch,p_operation_type:type,p_transaction_date:date,p_product_id:productId,p_source_location_id:location,p_destination_location_id:null,p_transaction_quantity:quantity,p_transaction_unit_id:unitId,p_transaction_unit_cost:cost,p_reference:"UOM-V2",p_reason:"Local deterministic QA",p_notes:null});if(r.error)throw r.error;return r.data; }
const balance=async productId=>{const r=await a.client.rpc("get_stock_summary",{p_organization_id:a.org,p_branch_id:a.branch,p_product_id:productId,p_location_id:location});if(r.error)throw r.error;return r.data.reduce((s,x)=>s+Number(x.quantity_on_hand),0)};
await stock(hinge,"opening",20,box.id,100); await stock(hinge,"adjustment_out",5,pcs.id); pass((await balance(hinge))===19.5,"5 PCS normalizes to 0.5 BOX and leaves 19.5 BOX");
await stock(cement,"opening",10,bag.id,72); await stock(cement,"adjustment_in",2,bag.id,72); pass((await balance(cement))===12,"2 BAG purchase-equivalent receipt increases stock to 12 BAG");
const customer=await a.client.rpc("create_customer",{p_organization_id:a.org,p_name:"UOM Client",p_payment_terms_days:30});if(customer.error)throw customer.error;
const income=await a.client.from("accounts").select("id").eq("organization_id",a.org).eq("system_key","sales_revenue").single();if(income.error)throw income.error;
const quotation=await a.client.rpc("save_operational_document",{p_org:a.org,p_kind:"quotation",p_id:null,p_customer:customer.data,p_branch:a.branch,p_date:date,p_expiry:date,p_reference:"UOM-QT",p_notes:null,p_lines:[{product_id:cement,description:"White Cement",quantity:25,transaction_unit_id:kg.id,unit_price:2.4,discount:0,tax_rate_id:null,revenue_account_id:income.data.id}]});if(quotation.error)throw quotation.error;
const qLine=await a.client.from("sales_quotation_lines").select("*").eq("quotation_id",quotation.data).single();if(qLine.error)throw qLine.error;
const invoice=await a.client.rpc("create_converted_sales_invoice_draft",{p_organization_id:a.org,p_customer_id:customer.data,p_invoice_date:date,p_due_date:date,p_branch_id:a.branch,p_reference:"UOM-INV",p_notes:null,p_lines:[{product_id:cement,description:"White Cement",quantity:25,transaction_unit_id:kg.id,unit_price:2.4,discount:0,tax_rate_id:null,revenue_account_id:income.data.id,inventory_location_id:location}],p_allocations:[{source_type:"quotation",source_document_id:quotation.data,source_line_id:qLine.data.id,quantity:.5}]});if(invoice.error)throw invoice.error;
const iLine=await a.client.from("sales_invoice_lines").select("quantity,unit_price,transaction_quantity,transaction_unit_code,transaction_unit_price,conversion_factor").eq("invoice_id",invoice.data).single();if(iLine.error)throw iLine.error;
pass(Number(iLine.data.quantity)===.5&&Number(iLine.data.transaction_quantity)===25&&iLine.data.transaction_unit_code==="KG","Quotation to Invoice preserves 25 KG while snapshotting 0.5 BAG");
pass(Number(iLine.data.unit_price)===120&&Number(iLine.data.transaction_unit_price)===2.4,"AED 120/BAG derives and preserves AED 2.40/KG");
const posted=await a.client.rpc("post_sales_invoice",{p_organization_id:a.org,p_invoice_id:invoice.data});if(posted.error)throw posted.error;pass((await balance(cement))===11.5,"posting the 25 KG invoice deducts exactly 0.5 BAG");
const supplier=await a.client.rpc("create_supplier",{p_organization_id:a.org,p_name:"UOM Supplier",p_payment_terms_days:30});if(supplier.error)throw supplier.error;
const expense=await a.client.from("accounts").select("id").eq("organization_id",a.org).eq("account_type","expense").limit(1).single();if(expense.error)throw expense.error;
const bill=await a.client.rpc("create_purchase_bill_draft",{p_organization_id:a.org,p_supplier_id:supplier.data,p_bill_date:date,p_due_date:date,p_branch_id:a.branch,p_reference:"UOM-BILL",p_notes:null,p_lines:[{product_id:hinge,description:"Cabinet Hinges",quantity:5,transaction_unit_id:pcs.id,unit_price:10,discount:0,tax_rate_id:null,expense_account_id:expense.data.id,inventory_location_id:location}]});if(bill.error)throw bill.error;
const postedBill=await a.client.rpc("post_purchase_bill",{p_organization_id:a.org,p_bill_id:bill.data});if(postedBill.error)throw postedBill.error;pass((await balance(hinge))===20,"posting a 5 PCS purchase adds exactly 0.5 BOX");
const custom=await a.client.rpc("save_inventory_unit",{p_org:a.org,p_id:null,p_name:"QA Sleeve",p_code:"SLV",p_status:"active"});if(custom.error)throw custom.error;
const duplicate=await a.client.rpc("save_inventory_unit",{p_org:a.org,p_id:null,p_name:"qa sleeve",p_code:"slv",p_status:"active"});pass(Boolean(duplicate.error),"case-insensitive duplicate unit is rejected");
const cross=await b.client.from("inventory_units").select("id").eq("id",custom.data);pass(!cross.error&&cross.data.length===0,"custom unit is invisible across organizations");
const forged=await b.client.rpc("save_inventory_unit",{p_org:a.org,p_id:custom.data,p_name:"Forged",p_code:"BAD",p_status:"inactive"});pass(Boolean(forged.error),"cross-organization unit edit is denied");
const sleeveProduct=await a.client.from("products").insert({organization_id:a.org,kind:"service",name:"QA Sleeve Service",sku:`UOM-${randomUUID().slice(0,8)}`,unit_id:custom.data,sales_price:50,purchase_price:0,track_inventory:false,created_by:(await a.client.auth.getUser()).data.user.id}).select("id").single();if(sleeveProduct.error)throw sleeveProduct.error;
const sleeveQuote=await a.client.rpc("save_operational_document",{p_org:a.org,p_kind:"quotation",p_id:null,p_customer:customer.data,p_branch:a.branch,p_date:date,p_expiry:date,p_reference:"UOM-SLV-HISTORY",p_notes:null,p_lines:[{product_id:sleeveProduct.data.id,description:"Sleeve Service",quantity:2,transaction_unit_id:custom.data,unit_price:50,discount:0,tax_rate_id:null,revenue_account_id:income.data.id}]});if(sleeveQuote.error)throw sleeveQuote.error;
const deactivate=await a.client.rpc("save_inventory_unit",{p_org:a.org,p_id:custom.data,p_name:"QA Sleeve",p_code:"SLV",p_status:"inactive"});if(deactivate.error)throw deactivate.error;
const historical=await a.client.from("sales_quotation_lines").select("transaction_quantity,transaction_unit_code,transaction_unit_name,conversion_factor").eq("quotation_id",sleeveQuote.data).single();if(historical.error)throw historical.error;
const existingProduct=await a.client.from("products").select("id,inventory_units:inventory_units!products_unit_id_fkey(code,status)").eq("id",sleeveProduct.data.id).single();if(existingProduct.error)throw existingProduct.error;
pass(Number(historical.data.transaction_quantity)===2&&historical.data.transaction_unit_code==="SLV"&&existingProduct.data.inventory_units?.status==="inactive","deactivated used unit remains readable on product and historical quotation");
const badProduct=await a.client.from("products").insert({organization_id:a.org,kind:"product",name:"Inactive unit product",unit_id:custom.data,track_inventory:true,created_by:(await a.client.auth.getUser()).data.user.id});pass(Boolean(badProduct.error),"inactive unit cannot be selected for a new product");
const snapshots=await a.client.from("stock_operation_uom_details").select("transaction_quantity,transaction_unit_code,conversion_factor").eq("organization_id",a.org);if(snapshots.error)throw snapshots.error;pass(snapshots.data.length===4,"all four manual stock operations retain entered-unit snapshots");
console.log(`CERTIFIED Units V2 local org ${a.org}: hinge 20 BOX after sale + purchase; cement 11.5 BAG; invoice ${invoice.data} preserves 25 KG.`);
