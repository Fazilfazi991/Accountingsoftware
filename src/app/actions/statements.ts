"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const filter = z.object({ partyType: z.enum(["customer", "supplier"]), partyId: uuid.optional(), from: z.string().date(), to: z.string().date(), branchId: uuid.optional(), state: z.enum(["all", "open", "settled"]).default("open") });
const n = (v: unknown) => Number(v || 0);
export type ReportData = { customers: any[]; suppliers: any[]; branches: any[]; statement?: { rows: any[]; opening: number; invoiced: number; credits: number; receipts: number; closing: number }; openItems?: any[] };

export async function getStatementReport(value: z.infer<typeof filter>): Promise<ReportData | { error: string }> {
  const parsed = filter.safeParse(value); if (!parsed.success || (parsed.data.partyId && parsed.data.from > parsed.data.to)) return { error: "Choose a valid party and date range." };
  try {
    const context = await requireOrganizationContext(); const client = await createClient(); const p = parsed.data;
    const [customers, suppliers] = await Promise.all([client.from("customers").select("id,name").eq("organization_id", context.organization.id).eq("is_active", true).order("name"), client.from("suppliers").select("id,name").eq("organization_id", context.organization.id).eq("is_active", true).order("name")]);
    if (customers.error || suppliers.error) return { error: "Unable to load report parties." };
    const base: ReportData = { customers: customers.data || [], suppliers: suppliers.data || [], branches: context.payload.allBranches };
    if (!p.partyId) return base;
    // Fetch the party's history on the server so opening balance remains correct even
    // when the selected range contains no activity; only range rows leave this action.
    const { data, error } = await client.rpc("get_party_statement", { p_organization_id: context.organization.id, p_party_type: p.partyType, p_party_id: p.partyId, p_from: "1900-01-01", p_to: p.to, p_branch_id: p.branchId || null });
    if (error) return { error: "Unable to run statement report." };
    const history = data || []; const rows = history.filter((x: any) => x.transaction_date >= p.from); const opening = history.filter((x: any) => x.transaction_date < p.from).at(-1)?.running_balance || 0;
    const invoiced = rows.filter((x: any) => x.transaction_type === (p.partyType === "customer" ? "Sales Invoice" : "Purchase Bill")).reduce((s: number, x: any) => s + n(x.debit), 0);
    const credits = rows.filter((x: any) => x.transaction_type.includes("Note")).reduce((s: number, x: any) => s + n(x.credit), 0);
    const receipts = rows.filter((x: any) => x.transaction_type.includes("Receipt") || x.transaction_type.includes("Payment")).reduce((s: number, x: any) => s + n(x.credit), 0);
    return { ...base, statement: { rows, opening, invoiced, credits, receipts, closing: rows.length ? n(rows.at(-1)?.running_balance) : opening } };
  } catch { return { error: "Unable to run statement report." }; }
}

export async function getOpenItemReport(value: z.infer<typeof filter>): Promise<ReportData | { error: string }> {
  const parsed = filter.safeParse(value); if (!parsed.success) return { error: "Choose valid report filters." };
  try { const context = await requireOrganizationContext(); const client = await createClient(); const p = parsed.data;
    const { data, error } = await client.rpc("get_open_item_report", { p_organization_id: context.organization.id, p_kind: p.partyType === "customer" ? "receivable" : "payable", p_state: p.state, p_as_of: p.to, p_branch_id: p.branchId || null });
    if (error) return { error: "Unable to run open-item report." };
    return { customers: [], suppliers: [], branches: context.payload.allBranches, openItems: data || [] };
  } catch { return { error: "Unable to run open-item report." }; }
}
