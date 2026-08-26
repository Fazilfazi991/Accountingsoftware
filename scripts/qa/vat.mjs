import { createClient } from "@supabase/supabase-js";
import "./safety.mjs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","LEDGERLY_QA_USER_A_EMAIL","LEDGERLY_QA_USER_A_PASSWORD","LEDGERLY_QA_USER_B_EMAIL","LEDGERLY_QA_USER_B_PASSWORD"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const login = async (client,email,password) => { const result=await client.auth.signInWithPassword({email,password}); if(result.error) throw result.error; };
const one = async (query) => { const result=await query.single(); if(result.error) throw result.error; return result.data; };
const rpc = async (client,name,args) => { const result=await client.rpc(name,args); if(result.error) throw result.error; return result.data; };
const pass = (condition,message) => { if(!condition) throw new Error(`FAIL ${message}`); console.log(`PASS ${message}`); };
const close = (actual,expected,tolerance=0.00001) => Math.abs(Number(actual)-Number(expected))<=tolerance;

const a=make(),b=make(),anon=make();
await login(a,process.env.LEDGERLY_QA_USER_A_EMAIL,process.env.LEDGERLY_QA_USER_A_PASSWORD);
await login(b,process.env.LEDGERLY_QA_USER_B_EMAIL,process.env.LEDGERLY_QA_USER_B_PASSWORD);
const org=await one(a.from("organizations").select("id").eq("slug","ledgerly-qa-company-a"));
const foreignOrg=await one(b.from("organizations").select("id").eq("slug","ledgerly-qa-company-b"));
const foreignParty=await one(b.from("customers").select("id").eq("organization_id",foreignOrg.id).limit(1));
const foreignBranch=await one(b.from("branches").select("id").eq("organization_id",foreignOrg.id).eq("status","active").limit(1));
const stamp=`VAT-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,today=new Date().toISOString().slice(0,10);
const branchId=await rpc(a,"create_organization_branch",{p_organization_id:org.id,p_name:`${stamp} Branch`});
await rpc(a,"initialize_inventory_foundation",{p_organization_id:org.id});
const location=await one(a.from("inventory_locations").select("id").eq("organization_id",org.id).eq("branch_id",branchId).eq("status","active").eq("is_default",true));
const unit=await one(a.from("inventory_units").select("id").eq("organization_id",org.id).eq("code","PCS"));
const vat5=await one(a.from("tax_rates").select("id").eq("organization_id",org.id).eq("code","VAT5"));
const zero=await one(a.from("tax_rates").select("id").eq("organization_id",org.id).eq("code","ZERO"));
const accounts={};
for(const key of ["sales_revenue","office_expense","main_bank","inventory","input_vat","output_vat","accounts_payable"]){accounts[key]=(await one(a.from("accounts").select("id,allow_manual_posting").eq("organization_id",org.id).eq("system_key",key))).id;}
const customer=await rpc(a,"create_customer",{p_organization_id:org.id,p_name:`${stamp} Customer`,p_trn:"100000000000001"});
const supplier=await rpc(a,"create_supplier",{p_organization_id:org.id,p_name:`${stamp} Supplier`,p_trn:"100000000000002"});
const service=await one(a.from("products").insert({organization_id:org.id,kind:"service",name:`${stamp} Service`,sku:`${stamp}-S`,unit_id:unit.id,track_inventory:false}).select("id"));
const product=await one(a.from("products").insert({organization_id:org.id,kind:"product",name:`${stamp} Stock`,sku:`${stamp}-P`,unit_id:unit.id,track_inventory:true}).select("id"));

const invoice=await rpc(a,"create_sales_invoice_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_date:today,p_due_date:today,p_lines:[{description:"VAT QA sale",quantity:5,unit_price:200,discount:0,tax_rate_id:vat5.id,revenue_account_id:accounts.sales_revenue,product_id:service.id,inventory_location_id:null}],p_branch_id:branchId,p_reference:`${stamp}-sale`,p_notes:null});
const invoicePost=await rpc(a,"post_sales_invoice",{p_organization_id:org.id,p_invoice_id:invoice});
const invoiceLine=await one(a.from("sales_invoice_lines").select("id").eq("invoice_id",invoice));
const credit=await rpc(a,"create_sales_credit_note_draft",{p_organization_id:org.id,p_customer_id:customer,p_invoice_id:invoice,p_credit_note_date:today,p_lines:[{source_invoice_line_id:invoiceLine.id,quantity:1,return_to_stock:false}],p_branch_id:branchId,p_reference:`${stamp}-credit`,p_notes:null});
const creditPost=await rpc(a,"post_sales_credit_note",{p_organization_id:org.id,p_credit_note_id:credit});

const bill=await rpc(a,"create_purchase_bill_draft",{p_organization_id:org.id,p_supplier_id:supplier,p_bill_date:today,p_due_date:today,p_lines:[{description:"VAT QA inventory purchase",quantity:4,unit_price:100,discount:0,tax_rate_id:vat5.id,expense_account_id:accounts.office_expense,product_id:product.id,inventory_location_id:location.id}],p_branch_id:branchId,p_reference:`${stamp}-purchase`,p_notes:null});
const billPost=await rpc(a,"post_purchase_bill",{p_organization_id:org.id,p_bill_id:bill});
const billLine=await one(a.from("purchase_bill_lines").select("id").eq("bill_id",bill));
const debit=await rpc(a,"create_purchase_debit_note_draft",{p_organization_id:org.id,p_supplier_id:supplier,p_bill_id:bill,p_debit_note_date:today,p_lines:[{source_bill_line_id:billLine.id,quantity:1,return_from_stock:true}],p_branch_id:branchId,p_reference:`${stamp}-debit`,p_notes:null});
const debitPost=await rpc(a,"post_purchase_debit_note",{p_organization_id:org.id,p_debit_note_id:debit});

const vatExpense=await rpc(a,"create_expense_draft",{p_organization_id:org.id,p_expense_date:today,p_expense_account_id:accounts.office_expense,p_payment_account_id:accounts.main_bank,p_net_amount:100,p_tax_rate_id:vat5.id,p_branch_id:branchId,p_payee_name:`${stamp} Expense`,p_reference:`${stamp}-expense`,p_notes:null});
await rpc(a,"post_expense",{p_organization_id:org.id,p_expense_id:vatExpense});
const zeroExpense=await rpc(a,"create_expense_draft",{p_organization_id:org.id,p_expense_date:today,p_expense_account_id:accounts.office_expense,p_payment_account_id:accounts.main_bank,p_net_amount:75,p_tax_rate_id:zero.id,p_branch_id:branchId,p_payee_name:`${stamp} Zero VAT`,p_reference:`${stamp}-zero`,p_notes:null});
await rpc(a,"post_expense",{p_organization_id:org.id,p_expense_id:zeroExpense});

const args={p_organization_id:org.id,p_from:today,p_to:today,p_branch_id:branchId,p_transaction_type:null,p_tax_rate_id:null,p_party_type:null,p_party_id:null};
const report=await rpc(a,"get_vat_report",args),s=report.summary,r=report.reconciliation;
pass(close(s.taxableSales,1000)&&close(s.salesCreditTaxable,200)&&close(s.netTaxableSales,800),"Taxable sales less Sales Credit Note equals AED 800");
pass(close(s.outputVat,50)&&close(s.salesCreditVat,10)&&close(s.netOutputVat,40),"Output VAT AED 50 less Credit Note VAT AED 10 equals AED 40");
pass(close(s.inputVat,25)&&close(s.debitNoteVat,5)&&close(s.netInputVat,20),"Purchase and Expense VAT less Debit Note VAT equals AED 20");
pass(close(s.netVatPosition,20),"Net VAT position is AED 20 payable");
pass(report.rows.length===6,"VAT transaction report returns the six isolated posted source/rate rows");
const zeroRow=report.rows.find((row)=>row.documentId===zeroExpense);
pass(zeroRow&&close(zeroRow.taxableAmount,75)&&close(zeroRow.vatAmount,0)&&close(zeroRow.grossAmount,75)&&zeroRow.taxTreatment==="zero_rated","Zero-rated expense is represented with AED 0 VAT and no false posting");
pass(report.rows.every((row)=>row.documentId!==invoicePost.journal_id&&row.transactionType!=="customer_receipt"&&row.transactionType!=="supplier_payment"),"Settlements are excluded and source documents are not double-counted");

const vat5Only=await rpc(a,"get_vat_report",{...args,p_tax_rate_id:vat5.id});
pass(vat5Only.rows.length===5&&vat5Only.rows.every((row)=>row.taxRateId===vat5.id),"VAT-rate filter returns only the configured rate");
const customerOnly=await rpc(a,"get_vat_report",{...args,p_party_type:"customer",p_party_id:customer});
pass(customerOnly.rows.length===2&&customerOnly.rows.every((row)=>row.partyId===customer),"Customer filter returns only owned customer VAT rows");
const expenseOnly=await rpc(a,"get_vat_report",{...args,p_transaction_type:"expense"});
pass(expenseOnly.rows.length===2&&expenseOnly.rows.every((row)=>row.transactionType==="expense"),"Transaction-type filter includes VAT and zero-VAT expenses");

pass(close(r.output.transactionDerived,40)&&close(r.output.manualOtherAdjustments,0)&&close(r.output.glTotal,40)&&close(r.output.difference,0),"Output VAT report reconciles to Output VAT GL");
pass(close(r.input.transactionDerived,20)&&close(r.input.manualOtherAdjustments,0)&&close(r.input.glTotal,20)&&close(r.input.difference,0),"Input VAT report reconciles to Input VAT GL");
const creditVatLines=await a.from("journal_lines").select("debit_amount,credit_amount").eq("journal_entry_id",creditPost.journal_id).eq("account_id",accounts.output_vat); if(creditVatLines.error) throw creditVatLines.error;
const debitVatLines=await a.from("journal_lines").select("debit_amount,credit_amount").eq("journal_entry_id",debitPost.journal_id).eq("account_id",accounts.input_vat); if(debitVatLines.error) throw debitVatLines.error;
pass(close(creditVatLines.data.reduce((sum,row)=>sum+Number(row.debit_amount)-Number(row.credit_amount),0),10),"Sales Credit Note VAT matches its posted Output VAT reversal");
pass(close(debitVatLines.data.reduce((sum,row)=>sum+Number(row.credit_amount)-Number(row.debit_amount),0),5),"Purchase Debit Note VAT matches its posted Input VAT reversal");
const purchaseLines=await a.from("journal_lines").select("account_id,debit_amount,credit_amount").eq("journal_entry_id",billPost.journal_id); if(purchaseLines.error) throw purchaseLines.error;
const purchaseCostEvent=await one(a.from("inventory_cost_events").select("journal_entry_id,value_delta").eq("organization_id",org.id).eq("source_document_id",bill).eq("event_type","purchase"));
const purchaseCostLines=await a.from("journal_lines").select("account_id,debit_amount,credit_amount").eq("journal_entry_id",purchaseCostEvent.journal_entry_id); if(purchaseCostLines.error) throw purchaseCostLines.error;
pass(close(purchaseLines.data.find((row)=>row.account_id===accounts.input_vat)?.debit_amount,20)&&close(purchaseLines.data.find((row)=>row.account_id===accounts.accounts_payable)?.credit_amount,420)&&close(purchaseCostEvent.value_delta,400)&&close(purchaseCostLines.data.find((row)=>row.account_id===accounts.inventory)?.debit_amount,400),"Inventory purchase separates net Inventory Asset from recoverable Input VAT");

pass(Boolean((await b.rpc("get_vat_report",{...args,p_organization_id:org.id})).error),"Cross-tenant VAT report access denied");
pass(Boolean((await a.rpc("get_vat_report",{...args,p_organization_id:foreignOrg.id})).error),"Foreign organization context denied");
pass(Boolean((await anon.rpc("get_vat_report",args)).error),"Anonymous VAT report access denied");
pass(Boolean((await a.rpc("get_vat_report",{...args,p_party_type:"customer",p_party_id:foreignParty.id})).error),"Cross-tenant party filter denied");
pass(Boolean((await a.rpc("get_vat_report",{...args,p_branch_id:foreignBranch.id})).error),"Cross-tenant branch filter denied");
const trial=await rpc(a,"get_trial_balance",{p_organization_id:org.id,p_as_of:today});
pass(close(trial.reduce((sum,row)=>sum+Number(row.debit),0),trial.reduce((sum,row)=>sum+Number(row.credit),0)),"Trial Balance remains balanced");
console.log("VAT reporting QA complete.");
