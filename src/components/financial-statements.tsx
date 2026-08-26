"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  exportBalanceSheetCsv,
  exportCashFlowCsv,
  exportProfitLossCsv,
  getBalanceSheet,
  getCashFlow,
  getProfitLoss,
  type BalanceSheetData,
  type CashFlowData,
  type FinancialStatement,
  type PeriodFilters,
  type ProfitLossData,
  type ReportOptions,
  type StatementAccount,
  type StatementGroup,
} from "@/app/actions/financial-statements";
import { useOrganizationContext } from "@/components/app-shell";

type View = "profit-loss" | "balance-sheet" | "cash-flow";
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const money = (value: number, signed = false) => {
  const amount = Number(value || 0);
  const formatted = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Math.abs(amount));
  if (amount < 0) return signed ? `-${formatted}` : `(${formatted})`;
  return signed && amount > 0 ? `+${formatted}` : formatted;
};
const nearZero = (value: number | null) => value !== null && Math.abs(Number(value)) < 0.005;

export function FinancialStatements({ view }: { view: View }) {
  const { branch: activeBranch } = useOrganizationContext();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState(activeBranch.id);
  const [options, setOptions] = useState<ReportOptions>({ branches: [], financialYears: [] });
  const [profitLoss, setProfitLoss] = useState<ProfitLossData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const result = view === "balance-sheet"
      ? await getBalanceSheet({ asOf: to, branchId: branchId || undefined })
      : view === "profit-loss"
        ? await getProfitLoss({ from, to, branchId: branchId || undefined })
        : await getCashFlow({ from, to, branchId: branchId || undefined });
    if ("error" in result) setError(result.error);
    else {
      setOptions(result.options);
      if (view === "balance-sheet") setBalanceSheet((result as FinancialStatement<BalanceSheetData>).report);
      if (view === "profit-loss") setProfitLoss((result as FinancialStatement<ProfitLossData>).report);
      if (view === "cash-flow") setCashFlow((result as FinancialStatement<CashFlowData>).report);
    }
    setLoading(false);
  }, [branchId, from, to, view]);

  useEffect(() => { void load(); }, [load]);

  const filters: PeriodFilters = { from, to, branchId: branchId || undefined };
  const download = async () => {
    const result = view === "profit-loss" ? await exportProfitLossCsv(filters)
      : view === "balance-sheet" ? await exportBalanceSheetCsv({ asOf: to, branchId: branchId || undefined })
        : await exportCashFlowCsv(filters);
    if ("error" in result) { setError(result.error); return; }
    const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename; anchor.click();
    URL.revokeObjectURL(url);
  };
  const applyFinancialYear = (id: string) => {
    const year = options.financialYears.find((item) => item.id === id);
    if (!year) return;
    setFrom(year.startDate); setTo(today < year.endDate ? today : year.endDate);
  };
  const title = view === "profit-loss" ? "Profit & Loss" : view === "balance-sheet" ? "Balance Sheet" : "Cash Flow";

  return <section className="panel financial-report">
    <div className="panel-head financial-report-head"><div><h2>{title}</h2><p>Authoritative posted-journal report · AED</p></div><button className="button" onClick={() => void download()} disabled={loading}>Export CSV</button></div>
    <div className="financial-filters">
      {view !== "balance-sheet" && <label>From Date<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>}
      <label>{view === "balance-sheet" ? "As of Date" : "To Date"}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches (consolidated)</option>{options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      {view !== "balance-sheet" && options.financialYears.length > 0 && <label>Financial Year<select defaultValue="" onChange={(event) => applyFinancialYear(event.target.value)}><option value="">Custom period</option>{options.financialYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>}
    </div>
    {loading && <p className="empty-state">Running {title}…</p>}
    {error && <p className="form-message error">{error}</p>}
    {!loading && !error && view === "profit-loss" && profitLoss && <ProfitLoss report={profitLoss} />}
    {!loading && !error && view === "balance-sheet" && balanceSheet && <BalanceSheet report={balanceSheet} />}
    {!loading && !error && view === "cash-flow" && cashFlow && <CashFlow report={cashFlow} />}
  </section>;
}

function AccountRows({ rows, from, to, sign = false }: { rows: StatementAccount[]; from: string; to: string; sign?: boolean }) {
  return rows.map((account) => <tr className="statement-account" key={account.accountId}>
    <td><Link href={`/reports/general-ledger?account=${account.accountId}&from=${from}&to=${to}`}>{account.accountCode} · {account.accountName}</Link></td>
    <td>{money(account.amount, sign)}</td>
  </tr>);
}
function GroupRows({ groups, from, to }: { groups: StatementGroup[]; from: string; to: string }) {
  return groups.flatMap((group) => [
    <tr className="statement-group" key={group.groupId}><th>{group.groupName}</th><th>{money(group.total)}</th></tr>,
    ...AccountRows({ rows: group.accounts, from, to }),
  ]);
}
function Total({ label, value, strong = false, signed = false }: { label: string; value: number; strong?: boolean; signed?: boolean }) {
  return <tr className={strong ? "statement-total statement-grand-total" : "statement-total"}><th>{label}</th><th>{money(value, signed)}</th></tr>;
}

function ProfitLoss({ report }: { report: ProfitLossData }) {
  return <div className="statement-scroll"><table className="statement-table"><tbody>
    <tr className="statement-section"><th>Revenue</th><th /></tr>
    <GroupRows groups={report.revenueGroups} from={report.from} to={report.to} />
    <Total label="Total Revenue" value={report.revenue} />
    <tr className="statement-section"><th>Cost of Goods Sold</th><th /></tr>
    <GroupRows groups={report.cogsGroups} from={report.from} to={report.to} />
    <Total label="Total Cost of Goods Sold" value={report.cogs} />
    <Total label="Gross Profit" value={report.grossProfit} strong />
    <tr className="statement-section"><th>Operating / Other Expenses</th><th /></tr>
    <GroupRows groups={report.expenseGroups} from={report.from} to={report.to} />
    <Total label="Total Expenses" value={report.expenses} />
    <Total label="Net Profit / Loss" value={report.netProfit} strong />
  </tbody></table></div>;
}

function BalanceSheet({ report }: { report: BalanceSheetData }) {
  const start = "1900-01-01";
  return <>
    <div className={`statement-status ${nearZero(report.difference) ? "success" : "error"}`}>{nearZero(report.difference) ? "Balanced" : `Out of balance by ${money(report.difference)}`}</div>
    <div className="statement-scroll"><table className="statement-table"><tbody>
      <tr className="statement-section"><th>Assets</th><th /></tr><GroupRows groups={report.assetGroups} from={start} to={report.asOf} /><Total label="Total Assets" value={report.assets} strong />
      <tr className="statement-section"><th>Liabilities</th><th /></tr><GroupRows groups={report.liabilityGroups} from={start} to={report.asOf} /><Total label="Total Liabilities" value={report.liabilities} />
      <tr className="statement-section"><th>Equity</th><th /></tr><GroupRows groups={report.equityGroups} from={start} to={report.asOf} />
      <tr className="statement-account derived"><td>Current Earnings (unclosed ledger profit / loss)</td><td>{money(report.currentEarnings)}</td></tr>
      <Total label="Total Equity" value={report.equity} /><Total label="Total Liabilities & Equity" value={report.liabilitiesAndEquity} strong />
    </tbody></table></div>
    <Reconciliations report={report} />
  </>;
}

function Reconciliations({ report }: { report: BalanceSheetData }) {
  const rows = [
    ["Accounts Receivable", report.reconciliations.ar], ["Accounts Payable", report.reconciliations.ap],
    ["Inventory", report.reconciliations.inventory], ["Cash & Bank / Dashboard", { ...report.reconciliations.cashBank, operational: report.reconciliations.cashBank.ledger, note: null }],
  ] as const;
  return <div className="reconciliation-block"><h3>Control reconciliations</h3><div className="statement-scroll"><table className="data-table"><thead><tr><th>Control</th><th>Ledger</th><th>Operational</th><th>Difference</th></tr></thead><tbody>{rows.map(([name, row]) => <tr key={name}><td>{name}{row.note && <small className="reconciliation-note">{row.note}</small>}</td><td>{money(row.ledger)}</td><td>{row.operational === null ? "Not attributable" : money(row.operational)}</td><td className={nearZero(row.difference) ? "reconciled" : "difference"}>{row.difference === null ? "—" : money(row.difference)}</td></tr>)}</tbody></table></div>
    <p className="report-note">Non-zero AR, AP, or inventory differences remain visible for legitimate manual journals and legacy records without operational provenance.</p>
  </div>;
}

function CashFlow({ report }: { report: CashFlowData }) {
  const sections: [string, StatementAccount[], number][] = [
    ["Operating Activities", report.operatingRows, report.operating],
    ["Investing Activities", report.investingRows, report.investing],
    ["Financing Activities", report.financingRows, report.financing],
  ];
  return <>
    <p className="report-note">Direct method from cash and bank journal movements. Account classifications are controlled in the Chart of Accounts.</p>
    <div className="statement-scroll"><table className="statement-table"><tbody>
      {sections.flatMap(([name, rows, total]) => [<tr className="statement-section" key={name}><th>{name}</th><th /></tr>, ...AccountRows({ rows, from: report.from, to: report.to, sign: true }), <Total key={`${name}-total`} label={`Net Cash from ${name}`} value={total} signed />])}
      {report.unclassifiedRows.length > 0 && <><tr className="statement-section warning"><th>Unclassified Cash Counterparts</th><th /></tr><AccountRows rows={report.unclassifiedRows} from={report.from} to={report.to} sign /><Total label="Unclassified Movement" value={report.unclassified} signed /></>}
      <Total label="Net Increase / Decrease in Cash" value={report.netCashMovement} strong signed />
      <Total label="Opening Cash" value={report.openingCash} /><Total label="Closing Cash" value={report.closingCash} strong />
    </tbody></table></div>
    <div className={`statement-status ${nearZero(report.reconciliationDifference) ? "success" : "error"}`}>{nearZero(report.reconciliationDifference) ? "Opening cash + net movement = closing cash" : `Cash flow difference ${money(report.reconciliationDifference)}`}</div>
  </>;
}
