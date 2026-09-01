import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import "./safety.mjs";

const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const a=make(),b=make();
const pass=(ok,label,detail="")=>{if(!ok)throw new Error(`FAIL ${label}${detail?`: ${detail}`:""}`);console.log(`PASS ${label}${detail?` | ${detail}`:""}`)};
const one=async q=>{const r=await q.single();if(r.error)throw r.error;return r.data};
const many=async q=>{const r=await q;if(r.error)throw r.error;return r.data??[]};
const rpc=async(c,name,args)=>{const r=await c.rpc(name,args);if(r.error)throw r.error;return r.data};
const num=x=>Number(x??0), sum=(xs,f)=>xs.reduce((n,x)=>n+num(f(x)),0), close=(x,y)=>Math.abs(x-y)<0.00001;

for(const [client,email,password] of [[a,process.env.LEDGERLY_QA_USER_A_EMAIL,process.env.LEDGERLY_QA_USER_A_PASSWORD],[b,process.env.LEDGERLY_QA_USER_B_EMAIL,process.env.LEDGERLY_QA_USER_B_PASSWORD]]){
  const r=await client.auth.signInWithPassword({email,password});if(r.error)throw r.error;
}
const org=await one(a.from("organizations").select("id").eq("slug","ledgerly-qa-company-a"));
const orgB=await one(b.from("organizations").select("id").eq("slug","ledgerly-qa-company-b"));
const branch=await one(a.from("branches").select("id").eq("organization_id",org.id).eq("status","active").limit(1));
const location=await one(a.from("inventory_locations").select("id").eq("organization_id",org.id).eq("branch_id",branch.id).eq("status","active").limit(1));
const customers=await many(a.from("customers").select("id,name").eq("organization_id",org.id).in("name",["LOCAL QA Sales Workflow Customer","LOCAL QA Sales Workflow Customer 2"]));
const customer=customers.find(x=>x.name.endsWith("Customer")).id, customer2=customers.find(x=>x.name.endsWith("Customer 2")).id;
const productsRaw=await many(a.from("products").select("id,name,sku,inventory_units(code)").eq("organization_id",org.id).in("sku",["LOCAL-QA-A","LOCAL-QA-B","LOCAL-QA-KG"]));
const products=Object.fromEntries(productsRaw.map(x=>[x.inventory_units.code,x]));
const vat=await one(a.from("tax_rates").select("id").eq("organization_id",org.id).eq("rate_percent",5).eq("sales_enabled",true).limit(1));
const revenue=await one(a.from("accounts").select("id").eq("organization_id",org.id).eq("system_key","sales_revenue"));
const prices={PCS:100,BOX:50,KG:20};
const line=(unit,quantity)=>({product_id:products[unit].id,description:products[unit].name,quantity,unit_price:prices[unit],discount:0,tax_rate_id:vat.id,revenue_account_id:revenue.id});
const quote=async(reference,lines,c=customer)=>rpc(a,"save_operational_document",{p_org:org.id,p_kind:"quotation",p_id:null,p_customer:c,p_branch:branch.id,p_date:"2026-09-01",p_expiry:"2026-09-30",p_reference:reference,p_notes:"Final local closure",p_lines:lines});
const directDn=async(reference,lines,c=customer)=>rpc(a,"save_operational_document",{p_org:org.id,p_kind:"delivery_note",p_id:null,p_customer:c,p_branch:branch.id,p_date:"2026-09-01",p_expiry:null,p_reference:reference,p_notes:"Final local closure",p_lines:lines});
const qlines=id=>many(a.from("sales_quotation_lines").select("*").eq("quotation_id",id));
const dnlines=id=>many(a.from("delivery_note_lines").select("*").eq("delivery_note_id",id));
const allocations=(type,id,lines,quantities=[])=>lines.map((x,i)=>({source_type:type,source_document_id:id,source_line_id:x.id,quantity:quantities[i]??num(x.quantity)}));
const invoiceLines=lines=>lines.map(x=>({product_id:x.product_id,description:x.description,quantity:num(x.quantity),unit_price:num(x.unit_price),discount:num(x.discount),tax_rate_id:x.tax_rate_id,revenue_account_id:x.revenue_account_id,inventory_location_id:location.id}));
const convertedInvoice=(lines,alloc,reference)=>rpc(a,"create_converted_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:"2026-09-01",p_due_date:"2026-09-01",p_lines:invoiceLines(lines),p_allocations:alloc,p_branch_id:branch.id,p_reference:reference,p_notes:"Final local closure"});
const post=id=>rpc(a,"post_sales_invoice",{p_organization_id:org.id,p_invoice_id:id});
const stock=async()=>(await many(a.from("stock_movements").select("product_id,signed_quantity").eq("organization_id",org.id).in("product_id",Object.values(products).map(x=>x.id)))).reduce((m,x)=>{m[x.product_id]=(m[x.product_id]||0)+num(x.signed_quantity);return m},{});
const counts=async()=>{const tables=["sales_invoices","sales_invoice_lines","delivery_notes","delivery_note_lines","document_conversion_lines","stock_movements","journal_entries"];const out={};for(const t of tables){const r=await a.from(t).select("id",{count:"exact",head:true}).eq("organization_id",org.id);if(r.error)throw r.error;out[t]=r.count??0}return out};
const unchanged=(x,y)=>Object.keys(x).every(k=>x[k]===y[k]);

const baseline=await stock();
const q1=await quote("LOCAL-QA-CLOSE-Q01",[line("PCS",5),line("KG",1.25)]), q2=await quote("LOCAL-QA-CLOSE-Q02",[line("BOX",3),line("KG",0.5)]);
const q1l=await qlines(q1),q2l=await qlines(q2), beforeDn=await counts(),stockBeforeDn=await stock();
const multiDn=await rpc(a,"create_converted_delivery_note",{p_org:org.id,p_customer:customer,p_branch:branch.id,p_date:"2026-09-01",p_reference:"LOCAL-QA-CLOSE-DN-MULTI-Q",p_notes:"Final local closure",p_lines:[...q1l,...q2l],p_allocations:[...allocations("quotation",q1,q1l),...allocations("quotation",q2,q2l)]});
const multiDnLines=await dnlines(multiDn),afterDn=await counts(),stockAfterDn=await stock();
const multiQAlloc=await many(a.from("document_conversion_lines").select("*").eq("organization_id",org.id).eq("target_type","delivery_note").eq("target_document_id",multiDn));
pass(afterDn.delivery_notes-beforeDn.delivery_notes===1&&afterDn.delivery_note_lines-beforeDn.delivery_note_lines===4&&multiQAlloc.length===4&&new Set(multiQAlloc.map(x=>x.source_document_id)).size===2,"Multi-Q to one DN database cardinality");
pass(JSON.stringify(stockBeforeDn)===JSON.stringify(stockAfterDn)&&afterDn.journal_entries===beforeDn.journal_entries,"Quotation and DN have zero stock/accounting impact");

const dn2=await directDn("LOCAL-QA-CLOSE-DN-SECOND",[line("PCS",2)]),dn2l=await dnlines(dn2);
const multiInv=await convertedInvoice([...multiDnLines,...dn2l],[...allocations("delivery_note",multiDn,multiDnLines),...allocations("delivery_note",dn2,dn2l)],"LOCAL-QA-CLOSE-I-MULTI-DN");await post(multiInv);
const multiInvAllocs=await many(a.from("document_conversion_lines").select("*").eq("target_type","sales_invoice").eq("target_document_id",multiInv));
pass(new Set(multiInvAllocs.map(x=>x.source_document_id)).size===2&&multiInvAllocs.length===5,"Multi-DN to one invoice allocations");

const partialDn=await directDn("LOCAL-QA-CLOSE-DN-PARTIAL",[line("BOX",20)]), partialLine=(await dnlines(partialDn))[0];
const part1={...partialLine,quantity:12},partInv1=await convertedInvoice([part1],allocations("delivery_note",partialDn,[partialLine],[12]),"LOCAL-QA-CLOSE-I-DN-12");await post(partInv1);
const rem8=await rpc(a,"source_line_remaining",{p_org:org.id,p_type:"delivery_note",p_line:partialLine.id});pass(close(rem8,8),"Partial DN remaining after 12","remaining=8");
const part2={...partialLine,quantity:8},partInv2=await convertedInvoice([part2],allocations("delivery_note",partialDn,[partialLine],[8]),"LOCAL-QA-CLOSE-I-DN-8");await post(partInv2);
const rem0=await rpc(a,"source_line_remaining",{p_org:org.id,p_type:"delivery_note",p_line:partialLine.id});pass(close(rem0,0),"Partial DN remaining after 12+8","remaining=0");

const qExtra=await quote("LOCAL-QA-CLOSE-Q-EXTRA",[line("PCS",5)]),qExtraLine=(await qlines(qExtra))[0],manual=line("BOX",3);
const extraInv=await convertedInvoice([qExtraLine,manual],allocations("quotation",qExtra,[qExtraLine]),"LOCAL-QA-CLOSE-I-EXTRA");await post(extraInv);
const extraLines=await many(a.from("sales_invoice_lines").select("*").eq("invoice_id",extraInv)),extraAlloc=await many(a.from("document_conversion_lines").select("*").eq("target_document_id",extraInv));
pass(extraLines.length===2&&extraAlloc.length===1&&extraAlloc[0].source_line_id===qExtraLine.id,"Manual extra item is not attributed to quotation");

const failAudit=async(label,attempt)=>{const before=await counts();const result=await attempt();pass(Boolean(result.error),`${label} rejected`,result.error?.message);const after=await counts();pass(unchanged(before,after),`${label} leaves no orphan`,JSON.stringify(before));};
const overQ=await quote("LOCAL-QA-CLOSE-Q-OVER",[line("PCS",1)]),overLine=(await qlines(overQ))[0];
await failAudit("Over-conversion",()=>a.rpc("create_converted_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:"2026-09-01",p_due_date:"2026-09-01",p_lines:invoiceLines([{...overLine,quantity:2}]),p_allocations:allocations("quotation",overQ,[overLine],[2]),p_branch_id:branch.id}));
await convertedInvoice([overLine],allocations("quotation",overQ,[overLine]),"LOCAL-QA-CLOSE-CONSUME");
await failAudit("Fully consumed source",()=>a.rpc("create_converted_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:"2026-09-01",p_due_date:"2026-09-01",p_lines:invoiceLines([overLine]),p_allocations:allocations("quotation",overQ,[overLine]),p_branch_id:branch.id}));
const sameQ=await quote("LOCAL-QA-CLOSE-Q-SAME-CUSTOMER",[line("PCS",1)]),sameLine=(await qlines(sameQ))[0];
const otherQ=await quote("LOCAL-QA-CLOSE-Q-OTHER-CUSTOMER",[line("PCS",1)],customer2),otherLine=(await qlines(otherQ))[0];
await failAudit("Different customers",()=>a.rpc("create_converted_delivery_note",{p_org:org.id,p_customer:customer,p_branch:branch.id,p_date:"2026-09-01",p_reference:null,p_notes:null,p_lines:[sameLine,otherLine],p_allocations:[...allocations("quotation",sameQ,[sameLine]),...allocations("quotation",otherQ,[otherLine])]}));
await failAudit("Cross-tenant source",()=>b.rpc("create_converted_delivery_note",{p_org:org.id,p_customer:customer,p_branch:branch.id,p_date:"2026-09-01",p_reference:null,p_notes:null,p_lines:[overLine],p_allocations:allocations("quotation",overQ,[overLine])}));
await failAudit("Invalid branch",()=>a.rpc("create_converted_delivery_note",{p_org:org.id,p_customer:customer,p_branch:randomUUID(),p_date:"2026-09-01",p_reference:null,p_notes:null,p_lines:[otherLine],p_allocations:allocations("quotation",otherQ,[otherLine])}));

const reconcile=async(id,label)=>{const invoice=await one(a.from("sales_invoices").select("*").eq("id",id));const lines=await many(a.from("sales_invoice_lines").select("*").eq("invoice_id",id));const journals=await many(a.from("journal_entries").select("id,source_type,status").eq("organization_id",org.id).eq("source_id",id));const journalIds=journals.map(x=>x.id);const jl=journalIds.length?await many(a.from("journal_lines").select("account_id,debit_amount,credit_amount").in("journal_entry_id",journalIds)):[];const accountRows=await many(a.from("accounts").select("id,system_key").eq("organization_id",org.id));const keys=new Map(accountRows.map(x=>[x.id,x.system_key]));const amount=k=>({debit:sum(jl.filter(x=>keys.get(x.account_id)===k),x=>x.debit_amount),credit:sum(jl.filter(x=>keys.get(x.account_id)===k),x=>x.credit_amount)});const movements=await many(a.from("stock_movements").select("signed_quantity").eq("source_document_type","sales_invoice").eq("source_document_id",id));const subtotal=sum(lines,x=>num(x.quantity)*num(x.unit_price)-num(x.discount)),vatAmount=subtotal*.05,ar=amount("accounts_receivable").debit,revenueAmount=amount("sales_revenue").credit,cogs=amount("cost_of_goods_sold").debit,inventory=amount("inventory").credit,debits=sum(jl,x=>x.debit_amount),credits=sum(jl,x=>x.credit_amount);pass(close(invoice.subtotal,subtotal)&&close(invoice.tax_total,vatAmount)&&close(invoice.grand_total,subtotal+vatAmount)&&close(ar,invoice.grand_total)&&close(revenueAmount,subtotal)&&close(cogs,inventory)&&close(debits,credits)&&journals.length===2,"Accounting reconciliation "+label);const row={label,invoice:id,subtotal,vat:vatAmount,total:subtotal+vatAmount,ar,revenue:revenueAmount,cogs,inventoryCredit:inventory,salesJournals:journals.filter(x=>x.source_type==="sales_invoice").length,cogsJournals:journals.filter(x=>x.source_type==="inventory_cost").length,stockMovements:movements.length};console.log("RECONCILE "+JSON.stringify(row));return row};
for(const [id,label] of [[multiInv,"multi-DN"],[partInv1,"partial-12"],[partInv2,"partial-8"],[extraInv,"manual-extra"]])await reconcile(id,label);

const directInv=await rpc(a,"create_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:"2026-09-01",p_due_date:"2026-09-01",p_lines:invoiceLines([line("KG",0.75)]),p_branch_id:branch.id,p_reference:"LOCAL-QA-CLOSE-HISTORICAL-DIRECT",p_notes:"No conversion source"});await post(directInv);await reconcile(directInv,"direct-decimal-KG");
const directAlloc=await many(a.from("document_conversion_lines").select("id").eq("target_document_id",directInv));pass(directAlloc.length===0,"Historical direct invoice has no conversion allocation");

const suiteInvoices=[multiInv,partInv1,partInv2,extraInv,directInv],finalStock=await stock(), sold={};for(const p of Object.values(products)){const rows=await many(a.from("stock_movements").select("signed_quantity").eq("organization_id",org.id).eq("product_id",p.id).eq("source_document_type","sales_invoice").in("source_document_id",suiteInvoices));sold[p.id]=-sum(rows,x=>x.signed_quantity)}
for(const unit of ["PCS","BOX","KG"]){const id=products[unit].id;pass(close(finalStock[id],baseline[id]-sold[id]),`Stock reconciliation ${unit}`,`baseline=${baseline[id]} sold=${sold[id]} final=${finalStock[id]}`)}
const summary=await rpc(a,"get_stock_summary",{p_organization_id:org.id,p_branch_id:null,p_location_id:null,p_product_id:null});for(const unit of ["PCS","BOX","KG"]){const row=summary.find(x=>x.product_id===products[unit].id);pass(row&&close(row.quantity_on_hand,finalStock[products[unit].id]),`Stock Summary matches ${unit}`)}
const closure={org:org.id,orgB:orgB.id,branch:branch.id,customer,customer2,products,multiDn,dn2,multiInv,partialDn,partInv1,partInv2,q1,q2,qExtra,extraInv,directInv,quotationNumbers:Object.fromEntries((await many(a.from("sales_quotations").select("id,quotation_number").in("id",[q1,q2,otherQ]))).map(x=>[x.id,x.quotation_number])),deliveryNumbers:Object.fromEntries((await many(a.from("delivery_notes").select("id,delivery_note_number").in("id",[multiDn,dn2,partialDn]))).map(x=>[x.id,x.delivery_note_number]))};
console.log("CLOSURE_FIXTURES "+JSON.stringify(closure));
console.log("FINAL LOCAL DATABASE CLOSURE COMPLETE");
