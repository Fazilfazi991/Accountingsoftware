import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","LEDGERLY_QA_USER_A_EMAIL","LEDGERLY_QA_USER_A_PASSWORD","LEDGERLY_QA_USER_B_EMAIL","LEDGERLY_QA_USER_B_PASSWORD"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const login=async(client,email,password)=>{const result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;};
const one=async(query)=>{const result=await query.single();if(result.error)throw result.error;return result.data;};
const rpc=async(client,name,args)=>{const result=await client.rpc(name,args);if(result.error)throw result.error;return result.data;};
const pass=(condition,message)=>{if(!condition)throw new Error(`FAIL ${message}`);console.log(`PASS ${message}`);};
const n=value=>Number(value||0), close=(actual,expected)=>Math.abs(n(actual)-n(expected))<0.00001;

const a=make(),b=make(),anon=make();
await login(a,process.env.LEDGERLY_QA_USER_A_EMAIL,process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b,process.env.LEDGERLY_QA_USER_B_EMAIL,process.env.LEDGERLY_QA_USER_B_PASSWORD);
const org=await one(a.from("organizations").select("id").eq("slug","ledgerly-qa-company-a"));
const foreignOrg=await one(b.from("organizations").select("id").eq("slug","ledgerly-qa-company-b"));
const foreignAccount=await one(b.from("accounts").select("id").eq("organization_id",foreignOrg.id).limit(1));
const foreignBranch=await one(b.from("branches").select("id").eq("organization_id",foreignOrg.id).eq("status","active").limit(1));
const stamp=`FS-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const today=new Date().toISOString().slice(0,10);
const openingDate=new Date(`${today}T00:00:00Z`);openingDate.setUTCDate(openingDate.getUTCDate()-1);
const before=openingDate.toISOString().slice(0,10);
const branchId=await rpc(a,"create_organization_branch",{p_organization_id:org.id,p_name:`${stamp} Branch`});

const groupRows=await a.from("account_groups").select("id,system_key").eq("organization_id",org.id);if(groupRows.error)throw groupRows.error;
const group=key=>{const row=groupRows.data.find(item=>item.system_key===key);if(!row)throw new Error(`Missing ${key} group`);return row.id;};
const usedResult=await a.from("accounts").select("code").eq("organization_id",org.id);if(usedResult.error)throw usedResult.error;
const used=new Set(usedResult.data.map(row=>row.code));let nextCode=7000;
const code=()=>{while(used.has(String(nextCode)))nextCode+=1;const value=String(nextCode);used.add(value);nextCode+=1;return value;};
const account=async(name,groupId,category)=>{
  const id=await rpc(a,"create_account",{p_organization_id:org.id,p_code:code(),p_name:`${stamp} ${name}`,p_account_group_id:groupId,p_description:"Batch 10.2 isolated QA",p_allow_manual_posting:true});
  await rpc(a,"set_account_cash_flow_category",{p_organization_id:org.id,p_account_id:id,p_category:category});
  return id;
};
const accounts={
  cash:(await one(a.from("accounts").select("id").eq("organization_id",org.id).eq("system_key","main_bank"))).id,
  revenue:await account("Revenue",group("income"),"operating"),
  cogs:await account("COGS",group("cost_of_sales"),"operating"),
  expense:await account("Operating Expense",group("operating_expenses"),"operating"),
  operatingAsset:await account("Operating Asset",group("other_assets"),"operating"),
  investingAsset:await account("Investing Asset",group("other_assets"),"investing"),
  openingAsset:await account("Opening Asset",group("other_assets"),"operating"),
  liability:await account("Financing Liability",group("current_liabilities"),"financing"),
  equity:await account("Opening Equity",group("equity"),"financing"),
};
const post=async(date,reference,lines)=>{
  const id=await rpc(a,"create_journal_draft",{p_organization_id:org.id,p_journal_date:date,p_branch_id:branchId,p_reference:`${stamp}-${reference}`,p_description:`${stamp} ${reference}`,p_lines:lines.map((line,index)=>({account_id:line[0],description:`${stamp} ${reference} ${index+1}`,debit:String(line[1]||0),credit:String(line[2]||0)}))});
  return rpc(a,"post_journal_entry",{p_organization_id:org.id,p_journal_id:id});
};

await post(before,"opening",[[accounts.cash,5000,0],[accounts.openingAsset,16000,0],[accounts.liability,0,7500],[accounts.equity,0,13500]]);
await post(today,"revenue",[[accounts.cash,10000,0],[accounts.revenue,0,10000]]);
await post(today,"cogs",[[accounts.cogs,4000,0],[accounts.cash,0,4000]]);
await post(today,"expense",[[accounts.expense,2500,0],[accounts.cash,0,2500]]);
await post(today,"working-capital",[[accounts.operatingAsset,1000,0],[accounts.cash,0,1000]]);
await post(today,"investing",[[accounts.investingAsset,1000,0],[accounts.cash,0,1000]]);
await post(today,"financing",[[accounts.cash,500,0],[accounts.liability,0,500]]);

const scope={p_organization_id:org.id,p_branch_id:branchId};
const pl=await rpc(a,"get_profit_and_loss",{...scope,p_from:today,p_to:today});
pass(close(pl.revenue,10000),"P&L Revenue is AED 10,000 from posted journals");
pass(close(pl.cogs,4000),"P&L COGS is AED 4,000");
pass(close(pl.grossProfit,6000),"P&L Gross Profit is AED 6,000");
pass(close(pl.expenses,2500),"P&L Operating Expenses are AED 2,500");
pass(close(pl.netProfit,3500),"P&L Net Profit is AED 3,500");
pass(pl.revenueGroups.some(item=>item.accounts.some(row=>row.accountId===accounts.revenue)),"Legitimate manual journal revenue is included with account drill-down identity");

const bs=await rpc(a,"get_balance_sheet",{...scope,p_as_of:today});
pass(close(bs.assets,25000),"Balance Sheet Assets are AED 25,000");
pass(close(bs.liabilities,8000),"Balance Sheet Liabilities are AED 8,000");
pass(close(bs.currentEarnings,3500)&&close(bs.equity,17000),"Current Earnings AED 3,500 derives Equity AED 17,000 without a closing journal");
pass(close(bs.assets,bs.liabilitiesAndEquity)&&close(bs.difference,0),"Balance Sheet satisfies AED 25,000 = AED 8,000 + AED 17,000");
pass(close(pl.netProfit,bs.currentEarnings),"P&L Net Profit agrees with Balance Sheet Current Earnings");
pass(close(bs.reconciliations.ar.difference,0)&&close(bs.reconciliations.ap.difference,0),"AR and AP ledger controls reconcile for the isolated branch");
pass(bs.reconciliations.inventory.operational===null&&Boolean(bs.reconciliations.inventory.note),"Branch inventory limitation is explicit rather than fabricated");

const cf=await rpc(a,"get_cash_flow_statement",{...scope,p_from:today,p_to:today});
pass(cf.method==="direct"&&close(cf.openingCash,5000),"Cash Flow opens at AED 5,000 using the direct ledger method");
pass(close(cf.operating,2500)&&close(cf.investing,-1000)&&close(cf.financing,500),"Cash Flow classifies Operating +2,500, Investing -1,000, Financing +500");
pass(close(cf.netCashMovement,2000)&&close(cf.closingCash,7000),"Cash Flow net movement AED 2,000 closes at AED 7,000");
pass(close(cf.unclassified,0)&&close(cf.reconciliationDifference,0),"Cash Flow has no unclassified or reconciliation difference");

const dashboard=await rpc(a,"get_live_dashboard",{...scope});
pass(close(bs.reconciliations.cashBank.ledger,n(dashboard.cash_on_hand)+n(dashboard.cash_at_bank)),"Balance Sheet Cash/Bank reconciles to dashboard cash and bank");
pass(close(cf.closingCash,bs.reconciliations.cashBank.ledger),"Cash Flow closing cash reconciles to Balance Sheet Cash/Bank");
const trial=await rpc(a,"get_trial_balance",{p_organization_id:org.id,p_as_of:today});
pass(close(trial.reduce((sum,row)=>sum+n(row.debit),0),trial.reduce((sum,row)=>sum+n(row.credit),0)),"Trial Balance remains balanced");

pass(Boolean((await b.rpc("get_profit_and_loss",{...scope,p_from:today,p_to:today})).error),"Cross-tenant P&L access is denied");
pass(Boolean((await anon.rpc("get_balance_sheet",{...scope,p_as_of:today})).error),"Anonymous Balance Sheet access is denied");
pass(Boolean((await a.rpc("get_cash_flow_statement",{...scope,p_branch_id:foreignBranch.id,p_from:today,p_to:today})).error),"Cross-tenant branch Cash Flow access is denied");
pass(Boolean((await a.rpc("get_general_ledger",{p_organization_id:org.id,p_account_id:foreignAccount.id,p_from:today,p_to:today})).error),"Cross-tenant General Ledger account filter is denied");
console.log("Financial statements QA complete.");
