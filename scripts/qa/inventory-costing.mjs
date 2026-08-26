import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import "./safety.mjs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","LEDGERLY_QA_USER_A_EMAIL","LEDGERLY_QA_USER_A_PASSWORD","LEDGERLY_QA_USER_B_EMAIL","LEDGERLY_QA_USER_B_PASSWORD"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const login = async (c,email,password) => { const r=await c.auth.signInWithPassword({email,password}); if(r.error) throw r.error; };
const one = async (q) => { const r=await q.single(); if(r.error) throw r.error; return r.data; };
const rpc = async (c,name,args) => { const r=await c.rpc(name,args); if(r.error) throw r.error; return r.data; };
const pass = (ok,message) => { if(!ok) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const close = (actual,expected,tolerance=0.00001) => Math.abs(Number(actual)-Number(expected))<=tolerance;

const a=make(),b=make();
await login(a,process.env.LEDGERLY_QA_USER_A_EMAIL,process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b,process.env.LEDGERLY_QA_USER_B_EMAIL,process.env.LEDGERLY_QA_USER_B_PASSWORD);
const org=await one(a.from("organizations").select("id").eq("slug","ledgerly-qa-company-a"));
const foreignOrg=await one(b.from("organizations").select("id").eq("slug","ledgerly-qa-company-b"));
const branch=await one(a.from("branches").select("id").eq("organization_id",org.id).eq("status","active").limit(1));
await rpc(a,"initialize_inventory_foundation",{p_organization_id:org.id});
const unit=await one(a.from("inventory_units").select("id").eq("organization_id",org.id).eq("code","PCS"));
const location=await one(a.from("inventory_locations").select("id").eq("organization_id",org.id).eq("branch_id",branch.id).eq("status","active").limit(1));
const accounts={};
for(const key of ["sales_revenue","rent_expense","inventory","cost_of_goods_sold"]){accounts[key]=(await one(a.from("accounts").select("id").eq("organization_id",org.id).eq("system_key",key))).id;}
const stamp=`COST-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,today=new Date().toISOString().slice(0,10);
const customer=await rpc(a,"create_customer",{p_organization_id:org.id,p_name:`${stamp} Customer`});
const supplier=await rpc(a,"create_supplier",{p_organization_id:org.id,p_name:`${stamp} Supplier`});
const product=await one(a.from("products").insert({organization_id:org.id,kind:"product",name:`${stamp} Widget`,sku:`${stamp}-P`,unit_id:unit.id,track_inventory:true}).select("id"));
const service=await one(a.from("products").insert({organization_id:org.id,kind:"service",name:`${stamp} Service`,sku:`${stamp}-S`,track_inventory:false}).select("id"));
const tracked=(quantity,unit_price,account)=>({description:"Tracked inventory",quantity,unit_price,discount:0,tax_rate_id:null,product_id:product.id,inventory_location_id:location.id,[account]:account==="revenue_account_id"?accounts.sales_revenue:accounts.rent_expense});
const serviceLine=(account)=>({description:"Service",quantity:1,unit_price:25,discount:0,tax_rate_id:null,product_id:service.id,inventory_location_id:null,[account]:account==="revenue_account_id"?accounts.sales_revenue:accounts.rent_expense});
const bill=async(quantity,price,name,mixed=false)=>{const id=await rpc(a,"create_purchase_bill_draft",{p_organization_id:org.id,p_supplier_id:supplier,p_bill_date:today,p_due_date:today,p_lines:[tracked(quantity,price,"expense_account_id"),...(mixed?[serviceLine("expense_account_id")]:[])],p_branch_id:branch.id,p_reference:`${stamp}-${name}`,p_notes:null}); await rpc(a,"post_purchase_bill",{p_organization_id:org.id,p_bill_id:id}); return id;};
const invoice=async(quantity,name,mixed=false)=>{const id=await rpc(a,"create_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:today,p_due_date:today,p_lines:[tracked(quantity,30,"revenue_account_id"),...(mixed?[serviceLine("revenue_account_id")]:[])],p_branch_id:branch.id,p_reference:`${stamp}-${name}`,p_notes:null}); await rpc(a,"post_sales_invoice",{p_organization_id:org.id,p_invoice_id:id}); return id;};
const state=async()=>{const rows=await rpc(a,"get_inventory_valuation_report",{p_organization_id:org.id,p_product_id:product.id}); return rows[0];};

const bill1=await bill(100,10,"purchase-1",true); let s=await state();
pass(close(s.quantity_on_hand,100)&&close(s.inventory_value,1000)&&close(s.average_unit_cost,10),"Purchase 100 @ 10 produces QOH 100, value 1,000, average 10");
const bill2=await bill(50,14,"purchase-2"); s=await state();
pass(close(s.quantity_on_hand,150)&&close(s.inventory_value,1700)&&close(s.average_unit_cost,11.3333333333),"Second purchase produces weighted average 11.3333333333");
const sale=await invoice(30,"sale",true); s=await state();
pass(close(s.quantity_on_hand,120)&&close(s.inventory_value,1360)&&close(s.average_unit_cost,11.3333333333),"Sale 30 posts COGS 340 and leaves value 1,360");
await bill(30,20,"purchase-3"); s=await state();
pass(close(s.quantity_on_hand,150)&&close(s.inventory_value,1960)&&close(s.average_unit_cost,13.0666666667),"Third purchase recalculates weighted average to 13.0666666667");

const saleLine=await one(a.from("sales_invoice_lines").select("id").eq("invoice_id",sale).eq("product_id",product.id));
const credit=await rpc(a,"create_sales_credit_note_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_id:sale,p_credit_note_date:today,p_lines:[{source_invoice_line_id:saleLine.id,quantity:5,return_to_stock:true}],p_branch_id:branch.id,p_reference:`${stamp}-sales-return`,p_notes:null});
await rpc(a,"post_sales_credit_note",{p_organization_id:org.id,p_credit_note_id:credit}); s=await state();
pass(close(s.quantity_on_hand,155)&&close(s.inventory_value,2016.666667),"Physical sales return restores five units at original issued cost");

const bill2Line=await one(a.from("purchase_bill_lines").select("id").eq("bill_id",bill2).eq("product_id",product.id));
const debit=await rpc(a,"create_purchase_debit_note_draft",{p_organization_id:org.id,p_supplier_id:supplier,p_bill_id:bill2,p_debit_note_date:today,p_lines:[{source_bill_line_id:bill2Line.id,quantity:10,return_from_stock:true}],p_branch_id:branch.id,p_reference:`${stamp}-purchase-return`,p_notes:null});
await rpc(a,"post_purchase_debit_note",{p_organization_id:org.id,p_debit_note_id:debit}); s=await state();
pass(close(s.quantity_on_hand,145)&&close(s.inventory_value,1876.666667),"Physical purchase return removes source-provenance value 140");

const qBefore=Number(s.quantity_on_hand),vBefore=Number(s.inventory_value);
const financialCredit=await rpc(a,"create_sales_credit_note_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_id:sale,p_credit_note_date:today,p_lines:[{source_invoice_line_id:saleLine.id,quantity:1,return_to_stock:false}],p_branch_id:branch.id,p_reference:`${stamp}-financial-credit`,p_notes:null});
await rpc(a,"post_sales_credit_note",{p_organization_id:org.id,p_credit_note_id:financialCredit}); s=await state();
pass(close(s.quantity_on_hand,qBefore)&&close(s.inventory_value,vBefore),"Financial-only sales credit note does not affect stock or cost");

const financialDebit=await rpc(a,"create_purchase_debit_note_draft",{p_organization_id:org.id,p_supplier_id:supplier,p_bill_id:bill1,p_debit_note_date:today,p_lines:[{source_bill_line_id:(await one(a.from("purchase_bill_lines").select("id").eq("bill_id",bill1).eq("product_id",product.id))).id,quantity:1,return_from_stock:false}],p_branch_id:branch.id,p_reference:`${stamp}-financial-debit`,p_notes:null});
await rpc(a,"post_purchase_debit_note",{p_organization_id:org.id,p_debit_note_id:financialDebit}); s=await state();
pass(close(s.quantity_on_hand,qBefore)&&close(s.inventory_value,vBefore-10),"Financial-only supplier credit preserves quantity and adjusts carrying value");

const transferId=randomUUID(); const transferArgs={p_operation_id:transferId,p_organization_id:org.id,p_branch_id:branch.id,p_operation_type:"transfer",p_transaction_date:today,p_product_id:product.id,p_source_location_id:location.id,p_destination_location_id:(await one(a.from("inventory_locations").insert({organization_id:org.id,branch_id:branch.id,name:`${stamp} Secondary`,code:`S${Date.now().toString().slice(-7)}`,is_default:false,status:"active"}).select("id"))).id,p_quantity:2,p_unit_cost:null,p_reference:stamp,p_reason:"Cost carry QA",p_notes:null};
const transfer=await rpc(a,"post_stock_operation",transferArgs); const repeated=await rpc(a,"post_stock_operation",transferArgs); const afterTransfer=await state();
pass(repeated.idempotent===true&&close(afterTransfer.quantity_on_hand,s.quantity_on_hand)&&close(afterTransfer.inventory_value,s.inventory_value)&&transfer.journal_id===null,"Transfer carries cost, preserves organization quantity/value, has no P&L, and is idempotent");

const valuation=await rpc(a,"get_inventory_valuation_report",{p_organization_id:org.id,p_product_id:null});
const valuationTotal=valuation.reduce((sum,row)=>sum+Number(row.inventory_value),0);
const inventoryLines=await a.from("journal_lines").select("debit_amount,credit_amount,journal_entries!inner(status),accounts!inner(system_key)").eq("organization_id",org.id).eq("accounts.system_key","inventory").eq("journal_entries.status","posted"); if(inventoryLines.error) throw inventoryLines.error;
const inventoryGl=inventoryLines.data.reduce((sum,row)=>sum+Number(row.debit_amount)-Number(row.credit_amount),0);
pass(close(valuationTotal,inventoryGl),"Inventory valuation report total reconciles to the posted Inventory GL");
const cogs=await rpc(a,"get_inventory_cogs_report",{p_organization_id:org.id,p_from:null,p_to:null,p_product_id:null});
const cogsTotal=cogs.reduce((sum,row)=>sum+Number(row.cogs_amount),0);
const cogsLines=await a.from("journal_lines").select("debit_amount,credit_amount,journal_entries!inner(status,source_type),accounts!inner(system_key)").eq("organization_id",org.id).eq("accounts.system_key","cost_of_goods_sold").eq("journal_entries.status","posted").eq("journal_entries.source_type","inventory_cost"); if(cogsLines.error) throw cogsLines.error;
const cogsGl=cogsLines.data.reduce((sum,row)=>sum+Number(row.debit_amount)-Number(row.credit_amount),0);
console.log(`INFO COGS report=${cogsTotal} GL=${cogsGl}`);
pass(close(cogsTotal,cogsGl),"COGS report reconciles to posted inventory-cost COGS journals (legacy opening/manual GL excluded)");

const ownEvents=await a.from("inventory_cost_events").select("id").eq("organization_id",org.id).eq("product_id",product.id); if(ownEvents.error) throw ownEvents.error;
const crossEvents=await b.from("inventory_cost_events").select("id").eq("organization_id",org.id).eq("product_id",product.id);
pass(!crossEvents.error&&crossEvents.data.length===0&&ownEvents.data.length>0,"Cost ledger RLS prevents cross-tenant reads");
const direct=await a.from("inventory_cost_events").insert({organization_id:foreignOrg.id,product_id:product.id,event_date:today,event_type:"opening",quantity_delta:1,unit_cost:1,value_delta:1,resulting_quantity:1,resulting_value:1,resulting_average_cost:1,source_document_type:"forged",source_document_id:randomUUID(),created_by:(await a.auth.getUser()).data.user.id});
pass(Boolean(direct.error),"Direct or cross-tenant cost ledger mutation is denied");
console.log("Inventory costing QA complete.");
