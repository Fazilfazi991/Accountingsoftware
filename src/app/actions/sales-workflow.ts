"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const filterSchema = z.object({
  search: z.string().trim().max(120).optional(), customerId: uuid.optional(),
  productId: uuid.optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  status: z.enum(["not_converted","partial","full"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1),
});
const lineSchema = z.object({ productId: uuid, description: z.string().trim().min(1).max(300), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0), discount: z.coerce.number().min(0), taxRateId: uuid.optional(), accountId: uuid });
const saveSchema = z.object({ id: uuid.optional(), kind: z.enum(["quotation","delivery_note"]), customerId: uuid, date: z.string().date(), expiry: z.string().date().optional(), reference: z.string().trim().max(120).optional(), notes: z.string().trim().max(500).optional(), lines: z.array(lineSchema).min(1), allocations: z.array(z.object({sourceType:z.enum(["quotation","delivery_note"]),sourceDocumentId:uuid,sourceLineId:uuid,quantity:z.coerce.number().positive()})).default([]) });
export type SalesWorkflowData = { customers:any[]; products:any[]; accounts:any[]; taxRates:any[]; quotations:any[]; quotationLines:any[]; deliveryNotes:any[]; deliveryLines:any[]; invoices:any[]; invoiceLines:any[]; conversions:any[]; page:number; pageSize:number; totalCount:number };

export async function getSalesWorkflowData(kind:"quotation"|"delivery_note"|"invoice", raw:unknown={}):Promise<SalesWorkflowData|{error:string}> {
  const parsed=filterSchema.safeParse(raw); if(!parsed.success) return {error:"Invalid filters."};
  try {
    const context=await requireOrganizationContext(), client=await createClient(), org=context.organization.id, f=parsed.data, pageSize=25;
    const [customers,products,accounts,taxRates,conversions]=await Promise.all([
      client.from("customers").select("id,name").eq("organization_id",org).eq("is_active",true).order("name"),
      client.from("products").select("id,name,sku,sales_price,tax_rate_id,unit_id,inventory_units(code)").eq("organization_id",org).eq("status","active").order("name"),
      client.from("accounts").select("id,name,account_type").eq("organization_id",org).eq("is_active",true).eq("account_type","income").order("code"),
      client.from("tax_rates").select("id,name,rate_percent,sales_enabled").eq("organization_id",org).eq("is_active",true),
      client.from("document_conversion_lines").select("*").eq("organization_id",org),
    ]);
    let documents:any, lines:any;
    if(kind==="quotation"){
      let q=client.from("sales_quotations").select("*,customers(name)").eq("organization_id",org).order("quotation_date",{ascending:false});
      if(f.customerId) q=q.eq("customer_id",f.customerId); if(f.from) q=q.gte("quotation_date",f.from); if(f.to) q=q.lte("quotation_date",f.to);
      documents=await q; lines=await client.from("sales_quotation_lines").select("*,products(name,sku,inventory_units(code))").eq("organization_id",org);
    } else if(kind==="delivery_note"){
      let q=client.from("delivery_notes").select("*,customers(name)").eq("organization_id",org).order("delivery_date",{ascending:false});
      if(f.customerId) q=q.eq("customer_id",f.customerId); if(f.from) q=q.gte("delivery_date",f.from); if(f.to) q=q.lte("delivery_date",f.to);
      documents=await q; lines=await client.from("delivery_note_lines").select("*,products(name,sku,inventory_units(code))").eq("organization_id",org);
    } else {
      let q=client.from("sales_invoices").select("*,customers(name)").eq("organization_id",org).order("invoice_date",{ascending:false});
      if(f.customerId) q=q.eq("customer_id",f.customerId); if(f.from) q=q.gte("invoice_date",f.from); if(f.to) q=q.lte("invoice_date",f.to);
      documents=await q; lines=await client.from("sales_invoice_lines").select("*,products(name,sku,inventory_units(code))").eq("organization_id",org);
    }
    const failed=[customers,products,accounts,taxRates,conversions,documents,lines].find(x=>x.error); if(failed?.error) return {error:"Unable to load sales documents. Apply the latest database migration first."};
    let docs=documents.data||[], ls=lines.data||[];
    if(f.productId){ const fk=kind==="quotation"?"quotation_id":kind==="delivery_note"?"delivery_note_id":"invoice_id", ids=new Set(ls.filter((x:any)=>x.product_id===f.productId).map((x:any)=>x[fk])); docs=docs.filter((x:any)=>ids.has(x.id)); ls=ls.filter((x:any)=>ids.has(x[fk])); }
    if(f.search){ const s=f.search.toLowerCase(), fk=kind==="quotation"?"quotation_id":kind==="delivery_note"?"delivery_note_id":"invoice_id", ids=new Set(ls.filter((x:any)=>`${x.description} ${x.products?.name||""} ${x.products?.sku||""}`.toLowerCase().includes(s)).map((x:any)=>x[fk])); docs=docs.filter((x:any)=>ids.has(x.id)||`${x.customers?.name||""}`.toLowerCase().includes(s)||Object.values(x).some(v=>typeof v==="string"&&v.toLowerCase().includes(s))); }
    if(f.status&&kind!=="invoice"){
      const fk=kind==="quotation"?"quotation_id":"delivery_note_id", sourceType=kind;
      docs=docs.filter((doc:any)=>{const own=ls.filter((x:any)=>x[fk]===doc.id),total=own.reduce((sum:number,x:any)=>sum+Number(x.quantity),0),used=(conversions.data||[]).filter((x:any)=>x.source_type===sourceType&&x.source_document_id===doc.id).reduce((sum:number,x:any)=>sum+Number(x.quantity),0);return f.status==="not_converted"?used<=0:f.status==="full"?used>=total&&total>0:used>0&&used<total;});
    }
    const totalCount=docs.length, pageIds=new Set(docs.slice((f.page-1)*pageSize,f.page*pageSize).map((x:any)=>x.id)), fk=kind==="quotation"?"quotation_id":kind==="delivery_note"?"delivery_note_id":"invoice_id";
    docs=docs.filter((x:any)=>pageIds.has(x.id)); ls=ls.filter((x:any)=>pageIds.has(x[fk]));
    return {customers:customers.data||[],products:products.data||[],accounts:accounts.data||[],taxRates:taxRates.data||[],quotations:kind==="quotation"?docs:[],quotationLines:kind==="quotation"?ls:[],deliveryNotes:kind==="delivery_note"?docs:[],deliveryLines:kind==="delivery_note"?ls:[],invoices:kind==="invoice"?docs:[],invoiceLines:kind==="invoice"?ls:[],conversions:conversions.data||[],page:f.page,pageSize,totalCount};
  } catch { return {error:"Unable to load sales documents."}; }
}

export async function saveOperationalDocument(raw:unknown){
 const parsed=saveSchema.safeParse(raw); if(!parsed.success) return {error:"Enter valid document details and at least one line."};
 try { const context=await requireOrganizationContext(),client=await createClient(),p=parsed.data;
  const rpcLines=p.lines.map(x=>({product_id:x.productId,description:x.description,quantity:x.quantity,unit_price:x.unitPrice,discount:x.discount,tax_rate_id:x.taxRateId||null,revenue_account_id:x.accountId}));
  const rpcAllocations=p.allocations.map(x=>({source_type:x.sourceType,source_document_id:x.sourceDocumentId,source_line_id:x.sourceLineId,quantity:x.quantity}));
  const convertedDelivery=p.kind==="delivery_note"&&!p.id&&p.allocations.length>0;
  const {data,error}=convertedDelivery
   ? await client.rpc("create_converted_delivery_note",{p_org:context.organization.id,p_customer:p.customerId,p_branch:context.branch.id,p_date:p.date,p_reference:p.reference||null,p_notes:p.notes||null,p_lines:rpcLines,p_allocations:rpcAllocations})
   : await client.rpc("save_operational_document",{p_org:context.organization.id,p_kind:p.kind,p_id:p.id||null,p_customer:p.customerId,p_branch:context.branch.id,p_date:p.date,p_expiry:p.expiry||null,p_reference:p.reference||null,p_notes:p.notes||null,p_lines:rpcLines});
  if(error) return {error:error.message.includes("converted_document")?"A document with conversions cannot be rewritten.":error.message};
  if(p.allocations.length&&!convertedDelivery){const recorded=await client.rpc("record_document_conversions",{p_org:context.organization.id,p_target_type:"delivery_note",p_target_id:data,p_allocations:rpcAllocations}); if(recorded.error)return {error:recorded.error.message};}
  revalidatePath("/","layout"); return {id:String(data)};
 } catch{return {error:"Unable to save document."};}
}

export async function getConversionSources(type:"quotation"|"delivery_note", ids:string[]){
 const valid=z.array(uuid).min(1).max(50).safeParse(ids); if(!valid.success)return {error:"Choose valid source documents."};
 try{const context=await requireOrganizationContext(),client=await createClient(),org=context.organization.id, docTable=type==="quotation"?"sales_quotations":"delivery_notes",lineTable=type==="quotation"?"sales_quotation_lines":"delivery_note_lines",fk=type==="quotation"?"quotation_id":"delivery_note_id";
  const [docs,lines,used]=await Promise.all([client.from(docTable).select("*").eq("organization_id",org).in("id",valid.data),client.from(lineTable).select("*,products(name,sku,inventory_units(code))").eq("organization_id",org).in(fk,valid.data),client.from("document_conversion_lines").select("source_line_id,quantity").eq("organization_id",org).eq("source_type",type).in("source_document_id",valid.data)]);
  if(docs.error||lines.error||used.error)return {error:"Unable to load conversion sources."}; const d=docs.data||[]; if(d.length!==valid.data.length||new Set(d.map((x:any)=>`${x.customer_id}:${x.branch_id}`)).size!==1)return {error:"Selected documents must belong to the same customer and branch."};
  const consumed=new Map<string,number>(); for(const x of used.data||[])consumed.set(x.source_line_id,(consumed.get(x.source_line_id)||0)+Number(x.quantity));
  return {customerId:d[0].customer_id,documents:d,lines:(lines.data||[]).map((x:any)=>({...x,sourceType:type,sourceDocumentId:x[fk],remaining:Math.max(0,Number(x.quantity)-(consumed.get(x.id)||0))})).filter((x:any)=>x.remaining>0)};
 }catch{return {error:"Unable to load conversion sources."};}
}

export async function recordInvoiceConversions(invoiceId:string, allocations:any[]){
 const parsed=z.object({invoiceId:uuid,allocations:z.array(z.object({sourceType:z.enum(["quotation","delivery_note"]),sourceDocumentId:uuid,sourceLineId:uuid,quantity:z.coerce.number().positive()})).min(1)}).safeParse({invoiceId,allocations}); if(!parsed.success)return {error:"Invalid source allocations."};
 try{const context=await requireOrganizationContext(),client=await createClient(),{error}=await client.rpc("record_document_conversions",{p_org:context.organization.id,p_target_type:"sales_invoice",p_target_id:invoiceId,p_allocations:allocations.map(x=>({source_type:x.sourceType,source_document_id:x.sourceDocumentId,source_line_id:x.sourceLineId,quantity:x.quantity}))}); return error?{error:error.message}:{ok:true};}catch{return{error:"Unable to record source traceability."};}
}

export async function saveConvertedInvoice(raw:unknown){
 const parsed=z.object({customerId:uuid,documentDate:z.string().date(),dueDate:z.string().date(),reference:z.string().trim().max(120).optional(),notes:z.string().trim().max(500).optional(),lines:z.array(lineSchema).min(1),allocations:z.array(z.object({sourceType:z.enum(["quotation","delivery_note"]),sourceDocumentId:uuid,sourceLineId:uuid,quantity:z.coerce.number().positive()})).min(1)}).safeParse(raw);
 if(!parsed.success||parsed.data.dueDate<parsed.data.documentDate)return{error:"Enter valid converted invoice details."};
 try{const context=await requireOrganizationContext(),client=await createClient(),p=parsed.data,{data,error}=await client.rpc("create_converted_sales_invoice_draft",{p_organization_id:context.organization.id,p_customer_id:p.customerId,p_invoice_date:p.documentDate,p_due_date:p.dueDate,p_lines:p.lines.map(x=>({description:x.description,quantity:x.quantity,unit_price:x.unitPrice,discount:x.discount,tax_rate_id:x.taxRateId||null,product_id:x.productId,inventory_location_id:(x as any).locationId||null,revenue_account_id:x.accountId})),p_allocations:p.allocations.map(x=>({source_type:x.sourceType,source_document_id:x.sourceDocumentId,source_line_id:x.sourceLineId,quantity:x.quantity})),p_branch_id:context.branch.id,p_reference:p.reference||null,p_notes:p.notes||null});if(error)return{error:error.message};revalidatePath("/","layout");return{id:String(data)};}catch{return{error:"Unable to save converted invoice atomically."};}
}
