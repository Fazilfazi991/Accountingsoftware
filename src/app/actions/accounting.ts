"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { error: string };
const text = z.string().trim().min(1).max(120);
const fail = (error: string): Result => ({ error });
const refresh = () => revalidatePath("/", "layout");
const rpc = async (name: string, args: Record<string, unknown>) => (await createClient()).rpc(name, args);

export async function initializeAccounting(input: { financialYearName?: string; startDate?: string; endDate?: string }): Promise<Result> {
  const context = await requireOrganizationContext();
  const { error } = await rpc("initialize_accounting_setup", { p_organization_id: context.organization.id, p_financial_year_name: input.financialYearName?.trim() || null, p_start_date: input.startDate || null, p_end_date: input.endDate || null });
  if (error) return fail("Accounting setup could not be initialized. Check the financial-year dates and try again.");
  refresh(); return { ok: true };
}

export async function saveAccount(input: { id?: string; code: string; name: string; groupId: string; description?: string; manualPosting: boolean; active: boolean; cashFlowCategory: "operating" | "investing" | "financing" }): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid().optional(), code: z.string().regex(/^\d{4}$/), name: text, groupId: z.string().uuid(), description: z.string().max(500).optional(), manualPosting: z.boolean(), active: z.boolean(), cashFlowCategory: z.enum(["operating", "investing", "financing"]) }).safeParse(input);
  if (!parsed.success) return fail("Enter a four-digit code, account name, and account group.");
  const context = await requireOrganizationContext();
  const args = parsed.data.id ? { p_organization_id: context.organization.id, p_account_id: parsed.data.id, p_code: parsed.data.code, p_name: parsed.data.name, p_account_group_id: parsed.data.groupId, p_description: parsed.data.description || "", p_allow_manual_posting: parsed.data.manualPosting, p_is_active: parsed.data.active } : { p_organization_id: context.organization.id, p_code: parsed.data.code, p_name: parsed.data.name, p_account_group_id: parsed.data.groupId, p_description: parsed.data.description || "", p_allow_manual_posting: parsed.data.manualPosting };
  const { data, error } = await rpc(parsed.data.id ? "update_account" : "create_account", args);
  if (error) return fail("This account could not be saved. System accounts cannot be deactivated and codes must be unique.");
  const accountId = parsed.data.id || String(data || "");
  const category = await rpc("set_account_cash_flow_category", { p_organization_id: context.organization.id, p_account_id: accountId, p_category: parsed.data.cashFlowCategory });
  if (category.error) return fail("The account was saved, but its cash-flow classification could not be applied.");
  refresh(); return { ok: true };
}

export async function saveAccountGroup(input: { code: string; name: string; classification: string }): Promise<Result> {
  const parsed = z.object({ code: z.string().regex(/^\d{4}$/), name: text, classification: z.enum(["asset", "liability", "equity", "income", "expense"]) }).safeParse(input);
  if (!parsed.success) return fail("Enter a four-digit code, name, and classification.");
  const context = await requireOrganizationContext(); const { error } = await rpc("create_account_group", { p_organization_id: context.organization.id, p_code: parsed.data.code, p_name: parsed.data.name, p_classification: parsed.data.classification });
  if (error) return fail("This account group could not be created.");
  refresh(); return { ok: true };
}

export async function saveFinancialYear(input: { name: string; startDate: string; endDate: string; isDefault: boolean }): Promise<Result> {
  const parsed = z.object({ name: text, startDate: z.string().date(), endDate: z.string().date(), isDefault: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("Enter a financial-year name and valid dates.");
  const context = await requireOrganizationContext(); const { error } = await rpc("create_financial_year", { p_organization_id: context.organization.id, p_name: parsed.data.name, p_start_date: parsed.data.startDate, p_end_date: parsed.data.endDate, p_is_default: parsed.data.isDefault });
  if (error) return fail("The financial year overlaps an existing year or has invalid dates.");
  refresh(); return { ok: true };
}

export async function saveDocumentSequence(input: { id: string; prefix: string; nextNumber: number; padding: number; suffix?: string }): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid(), prefix: z.string().max(30), nextNumber: z.number().int().positive(), padding: z.number().int().min(1).max(12), suffix: z.string().max(30).optional() }).safeParse(input);
  if (!parsed.success) return fail("Enter a valid next number and padding.");
  const context = await requireOrganizationContext(); const { error } = await rpc("update_document_sequence", { p_organization_id: context.organization.id, p_sequence_id: parsed.data.id, p_prefix: parsed.data.prefix, p_next_number: parsed.data.nextNumber, p_padding: parsed.data.padding, p_suffix: parsed.data.suffix || "" });
  if (error) return fail("The numbering configuration could not be saved.");
  refresh(); return { ok: true };
}

export async function createOperationalAccount(input: { kind: "cash" | "bank"; name: string; code: string; bankName?: string; maskedNumber?: string; iban?: string }): Promise<Result> {
  const parsed = z.object({ kind: z.enum(["cash", "bank"]), name: text, code: z.string().regex(/^\d{4}$/), bankName: z.string().max(120).optional(), maskedNumber: z.string().max(60).optional(), iban: z.string().max(50).optional() }).safeParse(input);
  if (!parsed.success || (parsed.data.kind === "bank" && !parsed.data.bankName?.trim())) return fail("Enter a name and four-digit account code. Bank name is required for a bank account.");
  const context = await requireOrganizationContext(); const { error } = await rpc(parsed.data.kind === "cash" ? "create_cash_account" : "create_bank_account", parsed.data.kind === "cash" ? { p_organization_id: context.organization.id, p_name: parsed.data.name, p_account_code: parsed.data.code } : { p_organization_id: context.organization.id, p_bank_name: parsed.data.bankName?.trim(), p_account_name: parsed.data.name, p_account_code: parsed.data.code, p_account_number_masked: parsed.data.maskedNumber?.trim() || null, p_iban: parsed.data.iban?.trim() || null });
  if (error) return fail("The account could not be created. Account codes must be unique.");
  refresh(); return { ok: true };
}

export async function createTaxRate(input: { code: string; name: string; rate: number; treatment: string }): Promise<Result> {
  const parsed = z.object({ code: text, name: text, rate: z.number().min(0).max(100), treatment: z.enum(["standard", "zero_rated", "exempt", "out_of_scope"]) }).safeParse(input);
  if (!parsed.success) return fail("Enter a code, name, valid rate, and treatment.");
  const context = await requireOrganizationContext(); const { error } = await rpc("create_tax_rate", { p_organization_id: context.organization.id, p_code: parsed.data.code, p_name: parsed.data.name, p_rate_percent: parsed.data.rate, p_treatment: parsed.data.treatment });
  if (error) return fail("The tax rate could not be created. Codes must be unique.");
  refresh(); return { ok: true };
}
