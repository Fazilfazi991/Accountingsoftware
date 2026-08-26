"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string; journal_id?: string; journalId?: string } | { error: string };
const uuid = z.string().uuid();
const input = z.object({ id: uuid.optional(), expenseDate: z.string().date(), expenseAccountId: uuid, paymentAccountId: uuid, netAmount: z.number().finite().positive(), taxRateId: uuid.optional(), payeeName: z.string().trim().max(200).optional(), reference: z.string().trim().max(500).optional(), notes: z.string().trim().max(4000).optional() });

function message(error: unknown) {
  const raw = String((error as { message?: string })?.message || error || "").toLowerCase();
  if (raw.includes("invalid_expense_account")) return "Select a valid expense account.";
  if (raw.includes("invalid_cash_or_bank")) return "Select an active Cash or Bank account.";
  if (raw.includes("invalid_vat_rate") || raw.includes("input_vat_account_missing")) return "Invalid VAT rate.";
  if (raw.includes("expense_not_editable") || raw.includes("already_posted")) return "This expense is already posted.";
  if (raw.includes("not_found") || raw.includes("permission") || raw.includes("access")) return "You do not have access to this expense.";
  if (raw.includes("financial_year")) return "The selected expense date is outside an open financial year.";
  return "This expense could not be saved. Please review the form and try again.";
}

async function contextAndClient() { const context = await requireOrganizationContext(); return { context, client: await createClient() }; }

export type ExpenseData = { expenses: any[]; expenseAccounts: any[]; paymentAccounts: any[]; taxRates: any[] };
export async function getExpenseData(): Promise<ExpenseData | { error: string }> {
  try {
    const { context, client } = await contextAndClient(); const org = context.organization.id;
    const [expenses, accounts, cash, bank, taxRates] = await Promise.all([
      client.from("expenses").select("id,expense_date,expense_number,payee_name,expense_account_id,tax_rate_id,net_amount,tax_amount,total_amount,payment_account_id,reference,notes,status,posted_journal_id,created_at").eq("organization_id", org).order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
      client.from("accounts").select("id,code,name,account_groups!inner(classification)").eq("organization_id", org).eq("is_active", true).eq("account_groups.classification", "expense").order("code"),
      client.from("cash_accounts").select("account_id,accounts!inner(id,code,name,account_type,is_active)").eq("organization_id", org).eq("is_active", true).eq("accounts.is_active", true),
      client.from("bank_accounts").select("account_id,accounts!inner(id,code,name,account_type,is_active)").eq("organization_id", org).eq("is_active", true).eq("accounts.is_active", true),
      client.from("tax_rates").select("id,code,name,rate_percent").eq("organization_id", org).eq("is_active", true).eq("purchase_enabled", true).order("rate_percent"),
    ]);
    const failed = [expenses, accounts, cash, bank, taxRates].find((item) => item.error); if (failed?.error) return { error: message(failed.error) };
    const paymentAccounts = [...(cash.data || []), ...(bank.data || [])].map((row: any) => row.accounts).filter((row: any) => row && ["cash", "bank"].includes(row.account_type));
    return { expenses: expenses.data || [], expenseAccounts: accounts.data || [], paymentAccounts, taxRates: taxRates.data || [] };
  } catch (error) { return { error: message(error) }; }
}

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  try { const { client } = await contextAndClient(); const { data, error } = await client.rpc(name, args); if (error) return { error: message(error) }; revalidatePath("/", "layout"); return { ok: true, ...(typeof data === "string" ? { id: data } : data || {}) }; } catch (error) { return { error: message(error) }; }
}
export async function saveExpense(value: z.infer<typeof input>): Promise<Result> {
  const parsed = input.safeParse(value); if (!parsed.success) return { error: "Enter a date, valid accounts, and a positive net amount." };
  const { context } = await contextAndClient(); const p = parsed.data;
  const args = { p_organization_id: context.organization.id, p_expense_date: p.expenseDate, p_expense_account_id: p.expenseAccountId, p_payment_account_id: p.paymentAccountId, p_net_amount: p.netAmount, p_tax_rate_id: p.taxRateId || null, p_branch_id: context.branch.id, p_payee_name: p.payeeName || null, p_reference: p.reference || null, p_notes: p.notes || null };
  return p.id ? call("update_expense_draft", { ...args, p_expense_id: p.id }) : call("create_expense_draft", args);
}
export async function postExpense(id: string) { if (!uuid.safeParse(id).success) return { error: "You do not have access to this expense." }; const { context } = await contextAndClient(); return call("post_expense", { p_organization_id: context.organization.id, p_expense_id: id }); }
export async function deleteExpense(id: string) { if (!uuid.safeParse(id).success) return { error: "You do not have access to this expense." }; const { context } = await contextAndClient(); return call("delete_expense_draft", { p_organization_id: context.organization.id, p_expense_id: id }); }
