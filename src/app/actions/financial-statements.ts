"use server";

import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const periodFilters = z.object({
  from: z.string().date(),
  to: z.string().date(),
  branchId: z.string().uuid().optional(),
}).refine((value) => value.from <= value.to, "From date must not be after To date.");
const balanceFilters = z.object({
  asOf: z.string().date(),
  branchId: z.string().uuid().optional(),
});

export type PeriodFilters = z.infer<typeof periodFilters>;
export type BalanceFilters = z.infer<typeof balanceFilters>;
export type StatementAccount = { accountId: string; accountCode: string; accountName: string; amount: number };
export type StatementGroup = {
  groupId: string;
  groupCode: string;
  groupName: string;
  total: number;
  accounts: StatementAccount[];
};
export type ProfitLossData = {
  from: string;
  to: string;
  branchId: string | null;
  revenueGroups: StatementGroup[];
  cogsGroups: StatementGroup[];
  expenseGroups: StatementGroup[];
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
};
type Reconciliation = { ledger: number; operational: number | null; difference: number | null; note?: string | null };
export type BalanceSheetData = {
  asOf: string;
  branchId: string | null;
  assetGroups: StatementGroup[];
  liabilityGroups: StatementGroup[];
  equityGroups: StatementGroup[];
  assets: number;
  liabilities: number;
  equityAccounts: number;
  currentEarnings: number;
  equity: number;
  liabilitiesAndEquity: number;
  difference: number;
  reconciliations: {
    ar: Reconciliation;
    ap: Reconciliation;
    inventory: Reconciliation;
    cashBank: { ledger: number; cash: number; bank: number; difference: number };
  };
};
export type CashFlowRow = StatementAccount;
export type CashFlowData = {
  method: "direct";
  from: string;
  to: string;
  branchId: string | null;
  operating: number;
  investing: number;
  financing: number;
  unclassified: number;
  netCashMovement: number;
  openingCash: number;
  closingCash: number;
  reconciliationDifference: number;
  operatingRows: CashFlowRow[];
  investingRows: CashFlowRow[];
  financingRows: CashFlowRow[];
  unclassifiedRows: CashFlowRow[];
};
export type ReportOptions = {
  branches: { id: string; name: string }[];
  financialYears: { id: string; name: string; startDate: string; endDate: string; isDefault: boolean }[];
};
export type FinancialStatement<T> = { report: T; options: ReportOptions };
type CsvDownload = { filename: string; content: string };

const options = async (client: Awaited<ReturnType<typeof createClient>>, context: Awaited<ReturnType<typeof requireOrganizationContext>>): Promise<ReportOptions> => {
  const years = await client.from("financial_years").select("id,name,start_date,end_date,is_default")
    .eq("organization_id", context.organization.id).order("start_date", { ascending: false });
  if (years.error) throw years.error;
  return {
    branches: context.payload.allBranches.filter((branch) => branch.active).map(({ id, name }) => ({ id, name })),
    financialYears: (years.data || []).map((year) => ({
      id: year.id, name: year.name, startDate: year.start_date, endDate: year.end_date, isDefault: year.is_default,
    })),
  };
};

async function load<T>(rpcName: string, args: Record<string, unknown>) {
  const context = await requireOrganizationContext();
  const client = await createClient();
  const [rpcResult, reportOptions] = await Promise.all([
    client.rpc(rpcName, { p_organization_id: context.organization.id, ...args }),
    options(client, context),
  ]);
  const { data, error } = rpcResult;
  if (error || !data) throw error || new Error("Financial statement unavailable");
  return { report: data as T, options: reportOptions };
}

export async function getProfitLoss(filters: PeriodFilters): Promise<FinancialStatement<ProfitLossData> | { error: string }> {
  const parsed = periodFilters.safeParse(filters);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Choose a valid reporting period." };
  try {
    return await load<ProfitLossData>("get_profit_and_loss", {
      p_from: parsed.data.from, p_to: parsed.data.to, p_branch_id: parsed.data.branchId || null,
    });
  } catch { return { error: "Unable to run Profit & Loss." }; }
}

export async function getBalanceSheet(filters: BalanceFilters): Promise<FinancialStatement<BalanceSheetData> | { error: string }> {
  const parsed = balanceFilters.safeParse(filters);
  if (!parsed.success) return { error: "Choose a valid as-of date." };
  try {
    return await load<BalanceSheetData>("get_balance_sheet", {
      p_as_of: parsed.data.asOf, p_branch_id: parsed.data.branchId || null,
    });
  } catch { return { error: "Unable to run Balance Sheet." }; }
}

export async function getCashFlow(filters: PeriodFilters): Promise<FinancialStatement<CashFlowData> | { error: string }> {
  const parsed = periodFilters.safeParse(filters);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Choose a valid reporting period." };
  try {
    return await load<CashFlowData>("get_cash_flow_statement", {
      p_from: parsed.data.from, p_to: parsed.data.to, p_branch_id: parsed.data.branchId || null,
    });
  } catch { return { error: "Unable to run Cash Flow." }; }
}

const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (rows: unknown[][]) => rows.map((row) => row.map(quote).join(",")).join("\r\n");
const groupRows = (groups: StatementGroup[]) => groups.flatMap((group) => [
  [group.groupName, "", group.total],
  ...group.accounts.map((account) => ["", `${account.accountCode} · ${account.accountName}`, account.amount]),
]);

export async function exportProfitLossCsv(filters: PeriodFilters): Promise<CsvDownload | { error: string }> {
  const result = await getProfitLoss(filters);
  if ("error" in result) return result;
  const r = result.report;
  return { filename: `profit-loss-${r.from}-to-${r.to}.csv`, content: csv([
    ["Profit & Loss"], ["From", r.from], ["To", r.to], [], ["Section / Group", "Account", "AED"],
    ["Revenue"], ...groupRows(r.revenueGroups), ["Total Revenue", "", r.revenue],
    ["Cost of Goods Sold"], ...groupRows(r.cogsGroups), ["Total COGS", "", r.cogs],
    ["Gross Profit", "", r.grossProfit], ["Expenses"], ...groupRows(r.expenseGroups),
    ["Total Expenses", "", r.expenses], ["Net Profit / Loss", "", r.netProfit],
  ]) };
}

export async function exportBalanceSheetCsv(filters: BalanceFilters): Promise<CsvDownload | { error: string }> {
  const result = await getBalanceSheet(filters);
  if ("error" in result) return result;
  const r = result.report;
  return { filename: `balance-sheet-${r.asOf}.csv`, content: csv([
    ["Balance Sheet"], ["As of", r.asOf], [], ["Section / Group", "Account", "AED"],
    ["Assets"], ...groupRows(r.assetGroups), ["Total Assets", "", r.assets],
    ["Liabilities"], ...groupRows(r.liabilityGroups), ["Total Liabilities", "", r.liabilities],
    ["Equity"], ...groupRows(r.equityGroups), ["Current Earnings (unclosed)", "", r.currentEarnings],
    ["Total Equity", "", r.equity], ["Total Liabilities & Equity", "", r.liabilitiesAndEquity],
    ["Balance Difference", "", r.difference], [], ["Reconciliation", "Ledger", "Operational", "Difference"],
    ["Accounts Receivable", r.reconciliations.ar.ledger, r.reconciliations.ar.operational, r.reconciliations.ar.difference],
    ["Accounts Payable", r.reconciliations.ap.ledger, r.reconciliations.ap.operational, r.reconciliations.ap.difference],
    ["Inventory", r.reconciliations.inventory.ledger, r.reconciliations.inventory.operational, r.reconciliations.inventory.difference],
    ["Cash & Bank / Dashboard", r.reconciliations.cashBank.ledger, r.reconciliations.cashBank.ledger, r.reconciliations.cashBank.difference],
  ]) };
}

export async function exportCashFlowCsv(filters: PeriodFilters): Promise<CsvDownload | { error: string }> {
  const result = await getCashFlow(filters);
  if ("error" in result) return result;
  const r = result.report;
  const rows = (items: CashFlowRow[]) => items.map((item) => [item.accountCode, item.accountName, item.amount]);
  return { filename: `cash-flow-${r.from}-to-${r.to}.csv`, content: csv([
    ["Cash Flow Statement (Direct Method)"], ["From", r.from], ["To", r.to], [], ["Section / Code", "Account", "AED"],
    ["Operating Activities"], ...rows(r.operatingRows), ["Operating Cash Flow", "", r.operating],
    ["Investing Activities"], ...rows(r.investingRows), ["Investing Cash Flow", "", r.investing],
    ["Financing Activities"], ...rows(r.financingRows), ["Financing Cash Flow", "", r.financing],
    ["Unclassified Cash Counterparts"], ...rows(r.unclassifiedRows), ["Unclassified", "", r.unclassified],
    ["Net Cash Movement", "", r.netCashMovement], ["Opening Cash", "", r.openingCash],
    ["Closing Cash", "", r.closingCash], ["Reconciliation Difference", "", r.reconciliationDifference],
  ]) };
}
