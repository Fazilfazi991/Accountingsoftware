"use server";

import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const optionalUuid = z.string().uuid().optional();
const vatFilters = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    branchId: optionalUuid,
    transactionType: z
      .enum([
        "sales_invoice",
        "sales_credit_note",
        "purchase_bill",
        "purchase_debit_note",
        "expense",
      ])
      .optional(),
    taxRateId: optionalUuid,
    partyType: z.enum(["customer", "supplier"]).optional(),
    partyId: optionalUuid,
  })
  .superRefine((value, context) => {
    if (value.from > value.to) {
      context.addIssue({ code: "custom", message: "From date must not be after To date." });
    }
    if (Boolean(value.partyType) !== Boolean(value.partyId)) {
      context.addIssue({ code: "custom", message: "Choose a valid customer or supplier." });
    }
  });

export type VatFilters = z.infer<typeof vatFilters>;
export type VatTransaction = {
  transactionDate: string;
  transactionType: "sales_invoice" | "sales_credit_note" | "purchase_bill" | "purchase_debit_note" | "expense";
  transactionLabel: string;
  documentId: string;
  documentNumber: string;
  partyType: "customer" | "supplier" | null;
  partyId: string | null;
  partyName: string;
  partyTrn: string | null;
  netAmount: number;
  taxableAmount: number;
  vatAmount: number;
  grossAmount: number;
  taxRateId: string | null;
  taxRateCode: string | null;
  taxRateName: string | null;
  ratePercent: number;
  taxTreatment: "standard" | "zero_rated" | "exempt" | "out_of_scope" | null;
  branchId: string | null;
  branchName: string | null;
  journalId: string;
  journalNumber: string;
};
export type VatSummary = {
  taxableSales: number;
  outputVat: number;
  salesCreditTaxable: number;
  salesCreditVat: number;
  netTaxableSales: number;
  netOutputVat: number;
  taxablePurchasesExpenses: number;
  inputVat: number;
  debitNoteTaxable: number;
  debitNoteVat: number;
  netTaxablePurchasesExpenses: number;
  netInputVat: number;
  netVatPosition: number;
};
export type VatReconciliationSide = {
  transactionDerived: number;
  manualOtherAdjustments: number;
  glTotal: number;
  difference: number;
};
export type VatReportData = {
  rows: VatTransaction[];
  summary: VatSummary;
  reconciliation: { output: VatReconciliationSide; input: VatReconciliationSide };
  branches: { id: string; name: string }[];
  taxRates: { id: string; code: string; name: string; rate_percent: number; treatment: string }[];
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
};

type CoreReport = Pick<VatReportData, "rows" | "summary" | "reconciliation">;
type CsvDownload = { filename: string; content: string };

async function loadCoreReport(filters: VatFilters) {
  const parsed = vatFilters.safeParse(filters);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Choose valid VAT report filters." } as const;
  try {
    const context = await requireOrganizationContext();
    const client = await createClient();
    const value = parsed.data;
    const { data, error } = await client.rpc("get_vat_report", {
      p_organization_id: context.organization.id,
      p_from: value.from,
      p_to: value.to,
      p_branch_id: value.branchId || null,
      p_transaction_type: value.transactionType || null,
      p_tax_rate_id: value.taxRateId || null,
      p_party_type: value.partyType || null,
      p_party_id: value.partyId || null,
    });
    if (error || !data) return { ok: false, error: "Unable to run the VAT report." } as const;
    return { ok: true, report: data as CoreReport, context, client, filters: value } as const;
  } catch {
    return { ok: false, error: "Unable to run the VAT report." } as const;
  }
}

export async function getVatReport(filters: VatFilters): Promise<VatReportData | { error: string }> {
  const loaded = await loadCoreReport(filters);
  if (!loaded.ok) return { error: loaded.error };
  const { client, context, report } = loaded;
  const [taxRates, customers, suppliers] = await Promise.all([
    client
      .from("tax_rates")
      .select("id,code,name,rate_percent,treatment")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .order("rate_percent", { ascending: false })
      .order("code"),
    client
      .from("customers")
      .select("id,name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .order("name"),
    client
      .from("suppliers")
      .select("id,name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .order("name"),
  ]);
  if (taxRates.error || customers.error || suppliers.error) return { error: "Unable to load VAT report filters." };
  return {
    ...report,
    branches: context.payload.allBranches.map(({ id, name }) => ({ id, name })),
    taxRates: taxRates.data || [],
    customers: customers.data || [],
    suppliers: suppliers.data || [],
  };
}

const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (rows: unknown[][]) => rows.map((row) => row.map(quote).join(",")).join("\r\n");
const stamp = (filters: VatFilters) => `${filters.from}-to-${filters.to}`;

export async function exportVatTransactionsCsv(filters: VatFilters): Promise<CsvDownload | { error: string }> {
  const loaded = await loadCoreReport(filters);
  if (!loaded.ok) return { error: loaded.error };
  const rows: unknown[][] = [
    ["VAT Transactions"],
    ["From", loaded.filters.from],
    ["To", loaded.filters.to],
    [],
    ["Date", "Transaction Type", "Document Number", "Party", "TRN", "Net Amount", "Taxable Amount", "VAT Rate", "Tax Treatment", "VAT Amount", "Gross Amount", "Branch", "Journal"],
    ...loaded.report.rows.map((row) => [
      row.transactionDate,
      row.transactionLabel,
      row.documentNumber,
      row.partyName,
      row.partyTrn,
      row.netAmount,
      row.taxableAmount,
      row.taxRateName || "No VAT assigned",
      row.taxTreatment || "not_assigned",
      row.vatAmount,
      row.grossAmount,
      row.branchName || "Unassigned",
      row.journalNumber,
    ]),
  ];
  return { filename: `vat-transactions-${stamp(filters)}.csv`, content: csv(rows) };
}

export async function exportVatSummaryCsv(filters: VatFilters): Promise<CsvDownload | { error: string }> {
  const loaded = await loadCoreReport(filters);
  if (!loaded.ok) return { error: loaded.error };
  const s = loaded.report.summary;
  const r = loaded.report.reconciliation;
  const rows: unknown[][] = [
    ["VAT Summary and Reconciliation"],
    ["From", loaded.filters.from],
    ["To", loaded.filters.to],
    [],
    ["Summary", "AED"],
    ["Taxable Sales", s.taxableSales],
    ["Output VAT", s.outputVat],
    ["Sales Credit Taxable Adjustment", s.salesCreditTaxable],
    ["Sales Credit VAT", s.salesCreditVat],
    ["Net Taxable Sales", s.netTaxableSales],
    ["Net Output VAT", s.netOutputVat],
    ["Taxable Purchases / Expenses", s.taxablePurchasesExpenses],
    ["Input VAT", s.inputVat],
    ["Debit Note Taxable Reversal", s.debitNoteTaxable],
    ["Debit Note VAT Reversal", s.debitNoteVat],
    ["Net Taxable Purchases / Expenses", s.netTaxablePurchasesExpenses],
    ["Net Input VAT", s.netInputVat],
    ["Net VAT Position", s.netVatPosition],
    [],
    ["Reconciliation", "Transaction-derived VAT", "Manual / Other Adjustments", "GL Total", "Difference"],
    ["Output VAT", r.output.transactionDerived, r.output.manualOtherAdjustments, r.output.glTotal, r.output.difference],
    ["Input VAT", r.input.transactionDerived, r.input.manualOtherAdjustments, r.input.glTotal, r.input.difference],
  ];
  return { filename: `vat-summary-${stamp(filters)}.csv`, content: csv(rows) };
}
