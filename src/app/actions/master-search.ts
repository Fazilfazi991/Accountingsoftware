"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
const kindSchema=z.enum(["customer","supplier","product","account","unit","location"]);
export async function searchMasterRecords(kind:z.infer<typeof kindSchema>,rawQuery:string){
 const parsed=kindSchema.safeParse(kind),query=rawQuery.trim().slice(0,80);if(!parsed.success||query.length<1)return [];
 const context=await requireOrganizationContext(),client=await createClient(),org=context.organization.id,q=`%${query.replaceAll("%","\\%").replaceAll(","," ")}%`;
 if(kind==="customer"||kind==="supplier"){const table=kind==="customer"?"customers":"suppliers";const {data,error}=await client.from(table).select("id,name,phone,email,billing_address").eq("organization_id",org).eq("is_active",true).or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q}`).order("name").limit(20);if(error)throw error;return(data||[]).map((x)=>({id:x.id,label:x.name,description:[x.phone,x.billing_address].filter(Boolean).join(" · ")}));}
 if(kind==="product"){const {data,error}=await client.from("products").select("id,name,sku,kind,inventory_units:inventory_units!products_unit_id_fkey(code)").eq("organization_id",org).eq("status","active").or(`name.ilike.${q},sku.ilike.${q}`).order("name").limit(20);if(error)throw error;return(data||[]).map((x:any)=>({id:x.id,label:x.name,description:[x.sku,x.inventory_units?.code].filter(Boolean).join(" · ")}));}
 const table=kind==="account"?"accounts":kind==="unit"?"inventory_units":"inventory_locations",fields=kind==="account"?"id,name,code,account_type":"id,name,code";
 let request=client.from(table).select(fields).eq("organization_id",org);request=kind==="account"?request.eq("is_active",true):request.eq("status","active");const {data,error}=await request.or(`name.ilike.${q},code.ilike.${q}`).order("name").limit(20);if(error)throw error;return(data||[]).map((x:any)=>({id:x.id,label:x.name,description:[x.code,x.account_type].filter(Boolean).join(" · ")}));
}
