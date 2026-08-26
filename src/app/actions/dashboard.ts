"use server";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
export type DashboardActivity={date:string;type:string;document_id:string;document_number:string;party_reference:string;amount:number;journal_id:string;href:string};
export type DashboardData={organization_id:string;branch_id:string;cash_on_hand:number;cash_account_id:string;cash_at_bank:number;bank_account_count:number;bank_accounts:{bank_account_id:string;account_id:string;name:string;balance:number}[];receivables:number;receivable_count:number;payables:number;payable_count:number;recent_activity:DashboardActivity[]};
export async function getLiveDashboard():Promise<DashboardData|{error:string}>{try{const context=await requireOrganizationContext();const client=await createClient();const {data,error}=await client.rpc("get_live_dashboard",{p_organization_id:context.organization.id,p_branch_id:context.branch.id});if(error||!data)return{error:"Unable to load live accounting balances."};return data as DashboardData}catch{return{error:"Unable to load live accounting balances."}}}
