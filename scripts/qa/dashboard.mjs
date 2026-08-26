import { createClient } from "@supabase/supabase-js";

const required=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","LEDGERLY_QA_USER_A_EMAIL","LEDGERLY_QA_USER_A_PASSWORD","LEDGERLY_QA_USER_B_EMAIL","LEDGERLY_QA_USER_B_PASSWORD"];
for(const key of required)if(!process.env[key])throw new Error(`Missing ${key}`);
const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const pass=(value,message)=>{if(!value)throw new Error(`FAIL ${message}`);console.log(`PASS ${message}`)};
const login=async(client,email,password)=>{const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error};
const num=value=>Number(value||0), close=(a,b)=>Math.abs(num(a)-num(b))<0.000001;

const a=make(),b=make(),anon=make();
await login(a,process.env.LEDGERLY_QA_USER_A_EMAIL,process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b,process.env.LEDGERLY_QA_USER_B_EMAIL,process.env.LEDGERLY_QA_USER_B_PASSWORD);
const {data:orgA,error:orgAError}=await a.from("organizations").select("id").eq("slug","ledgerly-qa-company-a").single();
const {data:orgB,error:orgBError}=await b.from("organizations").select("id").eq("slug","ledgerly-qa-company-b").single();
if(orgAError||orgBError)throw orgAError||orgBError;
const {data:branches,error:branchError}=await a.from("branches").select("id,name").eq("organization_id",orgA.id).eq("status","active").order("name");
if(branchError||!branches?.length)throw branchError||new Error("No QA branch");
const branch=branches[0];
const {data:dashboard,error:dashboardError}=await a.rpc("get_live_dashboard",{p_organization_id:orgA.id,p_branch_id:branch.id});
if(dashboardError)throw dashboardError;
pass(dashboard.organization_id===orgA.id&&dashboard.branch_id===branch.id,"Dashboard returns the requested tenant and branch scope");

const [{data:accounts,error:accountsError},{data:banks,error:banksError},{data:journals,error:journalsError},{data:lines,error:linesError},{data:items,error:itemsError}]=await Promise.all([
  a.from("accounts").select("id,system_key").eq("organization_id",orgA.id).eq("is_active",true),
  a.from("bank_accounts").select("id,account_id,branch_id").eq("organization_id",orgA.id).eq("is_active",true),
  a.from("journal_entries").select("id,branch_id,status").eq("organization_id",orgA.id).in("status",["posted","reversed"]),
  a.from("journal_lines").select("journal_entry_id,account_id,debit_amount,credit_amount").eq("organization_id",orgA.id),
  a.from("open_items").select("kind,remaining_amount,source_journal_id").eq("organization_id",orgA.id).gt("remaining_amount",0)
]);
if(accountsError||banksError||journalsError||linesError||itemsError)throw accountsError||banksError||journalsError||linesError||itemsError;
const branchJournalIds=new Set(journals.filter(row=>row.branch_id===branch.id).map(row=>row.id));
const scopedLines=lines.filter(row=>branchJournalIds.has(row.journal_entry_id));
const balanceFor=ids=>scopedLines.filter(row=>ids.has(row.account_id)).reduce((sum,row)=>sum+num(row.debit_amount)-num(row.credit_amount),0);
const cashId=accounts.find(row=>row.system_key==="cash_on_hand")?.id;
const bankIds=new Set(banks.filter(row=>row.branch_id===null||row.branch_id===branch.id).map(row=>row.account_id));
pass(close(dashboard.cash_on_hand,balanceFor(new Set([cashId]))),"Cash on Hand matches the posted cash ledger balance");
pass(close(dashboard.cash_at_bank,balanceFor(bankIds)),"Cash at Bank matches active bank ledger balances");
pass(close(dashboard.bank_accounts.reduce((sum,row)=>sum+num(row.balance),0),dashboard.cash_at_bank),"Bank breakdown reconciles to the Bank card");

const expectedOpen=kind=>items.filter(row=>row.kind===kind&&branchJournalIds.has(row.source_journal_id)).reduce((sum,row)=>sum+num(row.remaining_amount),0);
pass(close(dashboard.receivables,expectedOpen("receivable")),"Receivables matches scoped AR open items");
pass(close(dashboard.payables,expectedOpen("payable")),"Payables matches scoped AP open items");
const today=new Date().toISOString().slice(0,10);
const [{data:ar,error:arError},{data:ap,error:apError}]=await Promise.all([
  a.rpc("get_open_item_report",{p_organization_id:orgA.id,p_kind:"receivable",p_state:"open",p_as_of:today,p_branch_id:branch.id}),
  a.rpc("get_open_item_report",{p_organization_id:orgA.id,p_kind:"payable",p_state:"open",p_as_of:today,p_branch_id:branch.id})
]);
if(arError||apError)throw arError||apError;
pass(close(dashboard.receivables,ar.reduce((sum,row)=>sum+num(row.outstanding),0)),"Dashboard Receivables reconciles with the AR report");
pass(close(dashboard.payables,ap.reduce((sum,row)=>sum+num(row.outstanding),0)),"Dashboard Payables reconciles with the AP report");
pass(dashboard.recent_activity.every(row=>row.href?.startsWith("/")&&row.journal_id),"Recent activity exposes real document and journal links");

const {data:organizationDashboard,error:organizationError}=await a.rpc("get_live_dashboard",{p_organization_id:orgA.id,p_branch_id:null});
if(organizationError)throw organizationError;
const [{data:organizationAr,error:organizationArError},{data:organizationAp,error:organizationApError}]=await Promise.all([
  a.rpc("get_open_item_report",{p_organization_id:orgA.id,p_kind:"receivable",p_state:"open",p_as_of:today,p_branch_id:null}),
  a.rpc("get_open_item_report",{p_organization_id:orgA.id,p_kind:"payable",p_state:"open",p_as_of:today,p_branch_id:null})
]);
if(organizationArError||organizationApError)throw organizationArError||organizationApError;
pass(close(organizationDashboard.receivables,organizationAr.reduce((sum,row)=>sum+num(row.outstanding),0)),"Organization Receivables reconciles with the all-branch AR report");
pass(close(organizationDashboard.payables,organizationAp.reduce((sum,row)=>sum+num(row.outstanding),0)),"Organization Payables reconciles with the all-branch AP report");

const cross=await a.rpc("get_live_dashboard",{p_organization_id:orgB.id,p_branch_id:null});
const anonymous=await anon.rpc("get_live_dashboard",{p_organization_id:orgA.id,p_branch_id:branch.id});
const invalidBranch=await a.rpc("get_live_dashboard",{p_organization_id:orgA.id,p_branch_id:orgB.id});
pass(Boolean(cross.error),"Cross-tenant dashboard access is denied");
pass(Boolean(anonymous.error),"Anonymous dashboard access is denied");
pass(Boolean(invalidBranch.error),"Foreign branch scope is denied");
console.log(`CERTIFIED ${branch.name}: cash AED ${num(dashboard.cash_on_hand).toFixed(2)}, bank AED ${num(dashboard.cash_at_bank).toFixed(2)}, AR AED ${num(dashboard.receivables).toFixed(2)}, AP AED ${num(dashboard.payables).toFixed(2)}`);
console.log(`CERTIFIED all branches: cash AED ${num(organizationDashboard.cash_on_hand).toFixed(2)}, bank AED ${num(organizationDashboard.cash_at_bank).toFixed(2)}, AR AED ${num(organizationDashboard.receivables).toFixed(2)}, AP AED ${num(organizationDashboard.payables).toFixed(2)}`);
