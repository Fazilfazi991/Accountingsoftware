"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportVatSummaryCsv,
  exportVatTransactionsCsv,
  getVatReport,
  type VatFilters,
  type VatReportData,
  type VatTransaction,
} from "@/app/actions/vat";
import { useOrganizationContext } from "@/components/app-shell";

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const money = (value: unknown) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));
const number = (value: unknown) => Number(value || 0);

type View = "summary" | "transactions";
type UiFilters = VatFilters & { party: string };

export function VatReports({ view }: { view: View }) {
  const { branch: activeBranch } = useOrganizationContext();
  const [filters, setFilters] = useState<UiFilters>({
    from: monthStart,
    to: today,
    branchId: activeBranch.id,
    party: "",
  });
  const [data, setData] = useState<VatReportData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reportFilters = useMemo<VatFilters>(() => {
    const [partyType, partyId] = filters.party ? filters.party.split(":") : [];
    return {
      from: filters.from,
      to: filters.to,
      branchId: filters.branchId || undefined,
      transactionType: view === "transactions" ? filters.transactionType : undefined,
      taxRateId: view === "transactions" ? filters.taxRateId : undefined,
      partyType: view === "transactions" && partyType ? (partyType as "customer" | "supplier") : undefined,
      partyId: view === "transactions" ? partyId : undefined,
    };
  }, [filters, view]);
  const load = useCallback(async () => {
    const result = await getVatReport(reportFilters);
    if ("error" in result) setError(result.error);
    else {
      setData(result);
      setError("");
    }
  }, [reportFilters]);
  useEffect(() => {
    void load();
  }, [load]);

  const download = async () => {
    const result =
      view === "summary"
        ? await exportVatSummaryCsv(reportFilters)
        : await exportVatTransactionsCsv(reportFilters);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice("CSV exported from the current server-side report filters.");
  };

  return (
    <>
      <div className="page-header vat-heading">
        <div>
          <h1>{view === "summary" ? "VAT Summary" : "VAT Transactions"}</h1>
          <p>UAE-friendly VAT reporting from posted documents and configured tax rates.</p>
        </div>
        <div className="header-actions">
          <Link className={`button ${view === "summary" ? "" : "secondary"}`} href="/reports/vat-summary">
            Summary
          </Link>
          <Link className={`button ${view === "transactions" ? "" : "secondary"}`} href="/reports/vat-transactions">
            Transactions
          </Link>
        </div>
      </div>
      <section className="panel toolbar report-toolbar vat-toolbar" aria-label="VAT report filters">
        <label>
          <span>From</span>
          <input type="date" value={filters.from} onChange={(event) => setFilters((old) => ({ ...old, from: event.target.value }))} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={filters.to} onChange={(event) => setFilters((old) => ({ ...old, to: event.target.value }))} />
        </label>
        <label>
          <span>Branch</span>
          <select value={filters.branchId || ""} onChange={(event) => setFilters((old) => ({ ...old, branchId: event.target.value || undefined }))}>
            <option value="">All branches</option>
            {(data?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        {view === "transactions" && (
          <>
            <label>
              <span>Type</span>
              <select value={filters.transactionType || ""} onChange={(event) => setFilters((old) => ({ ...old, transactionType: (event.target.value || undefined) as VatFilters["transactionType"] }))}>
                <option value="">All types</option>
                <option value="sales_invoice">Sales Invoice</option>
                <option value="sales_credit_note">Sales Credit Note</option>
                <option value="purchase_bill">Purchase Bill</option>
                <option value="purchase_debit_note">Purchase Debit Note</option>
                <option value="expense">Expense</option>
              </select>
            </label>
            <label>
              <span>VAT rate</span>
              <select value={filters.taxRateId || ""} onChange={(event) => setFilters((old) => ({ ...old, taxRateId: event.target.value || undefined }))}>
                <option value="">All configured rates</option>
                {(data?.taxRates || []).map((rate) => <option key={rate.id} value={rate.id}>{rate.code} · {rate.name}</option>)}
              </select>
            </label>
            <label>
              <span>Customer / Supplier</span>
              <select value={filters.party} onChange={(event) => setFilters((old) => ({ ...old, party: event.target.value }))}>
                <option value="">All parties</option>
                <optgroup label="Customers">
                  {(data?.customers || []).map((party) => <option key={`customer:${party.id}`} value={`customer:${party.id}`}>{party.name}</option>)}
                </optgroup>
                <optgroup label="Suppliers">
                  {(data?.suppliers || []).map((party) => <option key={`supplier:${party.id}`} value={`supplier:${party.id}`}>{party.name}</option>)}
                </optgroup>
              </select>
            </label>
          </>
        )}
        <button className="button" onClick={() => void load()}>Run report</button>
        <button className="button secondary" onClick={() => void download()}>Export CSV</button>
      </section>
      {error && <p className="error">{error}</p>}
      {notice && <p className="vat-export-notice">{notice}</p>}
      {!data ? (
        <section className="panel empty">Loading posted VAT activity…</section>
      ) : view === "summary" ? (
        <VatSummaryReport data={data} from={filters.from} to={filters.to} />
      ) : (
        <VatTransactionsReport rows={data.rows} />
      )}
    </>
  );
}

function VatSummaryReport({ data, from, to }: { data: VatReportData; from: string; to: string }) {
  const { summary, reconciliation } = data;
  const position = number(summary.netVatPosition);
  const positionLabel = position > 0 ? "VAT Payable" : position < 0 ? "VAT Recoverable" : "Net VAT Position";
  return (
    <div className="vat-report-stack">
      <section className="vat-primary" aria-label="Primary VAT totals">
        <div><span>Net Output VAT</span><strong>{money(summary.netOutputVat)}</strong></div>
        <div><span>Net Input VAT</span><strong>{money(summary.netInputVat)}</strong></div>
        <div className={position < 0 ? "recoverable" : "payable"}><span>{positionLabel}</span><strong>{money(Math.abs(position))}</strong></div>
      </section>
      <section className="panel vat-period-note">
        <b>VAT period</b><span>{from} to {to}</span>
        <small>This accounting report is not an FTA return form or filing certification.</small>
      </section>
      <div className="vat-summary-grid">
        <section className="panel report-panel">
          <div className="panel-head"><div><h2>Output VAT</h2><p>Posted taxable sales less Sales Credit Notes.</p></div></div>
          <div className="vat-lines">
            <Row label="Taxable Sales" value={summary.taxableSales} />
            <Row label="Output VAT" value={summary.outputVat} />
            <Row label="Sales Credit taxable adjustment" value={-number(summary.salesCreditTaxable)} />
            <Row label="Sales Credit VAT" value={-number(summary.salesCreditVat)} />
            <Row label="Net Taxable Sales" value={summary.netTaxableSales} strong />
            <Row label="Net Output VAT" value={summary.netOutputVat} strong />
          </div>
        </section>
        <section className="panel report-panel">
          <div className="panel-head"><div><h2>Input VAT</h2><p>Posted bills and expenses less Purchase Debit Notes.</p></div></div>
          <div className="vat-lines">
            <Row label="Taxable Purchases / Expenses" value={summary.taxablePurchasesExpenses} />
            <Row label="Input VAT" value={summary.inputVat} />
            <Row label="Debit Note taxable reversal" value={-number(summary.debitNoteTaxable)} />
            <Row label="Debit Note VAT reversal" value={-number(summary.debitNoteVat)} />
            <Row label="Net Taxable Purchases / Expenses" value={summary.netTaxablePurchasesExpenses} strong />
            <Row label="Net Input VAT" value={summary.netInputVat} strong />
          </div>
        </section>
      </div>
      <section className="panel report-panel">
        <div className="panel-head"><div><h2>VAT to General Ledger reconciliation</h2><p>Manual entries, reversals, opening balances, and other non-document VAT movements remain visible as separate adjustments.</p></div></div>
        <div className="table-wrap"><table className="vat-reconciliation"><thead><tr><th>VAT account</th><th>Transaction-derived VAT</th><th>Manual / Other adjustments</th><th>GL total</th><th>Difference</th></tr></thead><tbody>
          <ReconciliationRow label="Output VAT" side={reconciliation.output} />
          <ReconciliationRow label="Input VAT" side={reconciliation.input} />
        </tbody></table></div>
      </section>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: unknown; strong?: boolean }) {
  const content = <><span>{label}</span><b>{money(value)}</b></>;
  return strong ? <strong>{content}</strong> : <div>{content}</div>;
}

function ReconciliationRow({ label, side }: { label: string; side: VatReportData["reconciliation"]["output"] }) {
  return <tr><td><b>{label}</b></td><td className="amount">{money(side.transactionDerived)}</td><td className="amount">{money(side.manualOtherAdjustments)}</td><td className="amount">{money(side.glTotal)}</td><td className="amount">{money(side.difference)}</td></tr>;
}

function sourcePath(row: VatTransaction) {
  if (row.transactionType === "sales_invoice") return `/sales/invoices/${row.documentId}`;
  if (row.transactionType === "sales_credit_note") return `/sales/credit-notes/${row.documentId}`;
  if (row.transactionType === "purchase_bill") return `/purchases/bills/${row.documentId}`;
  if (row.transactionType === "purchase_debit_note") return `/purchases/debit-notes/${row.documentId}`;
  return `/expenses/${row.documentId}`;
}

function VatTransactionsReport({ rows }: { rows: VatTransaction[] }) {
  const taxable = rows.reduce((sum, row) => sum + number(row.taxableAmount), 0);
  const vat = rows.reduce((sum, row) => sum + number(row.vatAmount), 0);
  return (
    <section className="panel report-panel vat-transactions">
      <div className="panel-head"><div><h2>Posted VAT activity</h2><p>One row per source document and configured VAT rate. Credit and Debit Note reversals are negative.</p></div><div className="vat-table-totals"><span>Taxable <b>{money(taxable)}</b></span><span>VAT <b>{money(vat)}</b></span></div></div>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Party</th><th>TRN</th><th>Taxable Amount</th><th>VAT Rate</th><th>VAT</th><th>Gross</th><th>Branch</th><th>Journal</th></tr></thead><tbody>
        {rows.map((row) => <tr key={`${row.transactionType}:${row.documentId}:${row.taxRateId || "none"}`}>
          <td>{row.transactionDate}</td><td>{row.transactionLabel}</td><td><Link className="record-link" href={sourcePath(row)}>{row.documentNumber}</Link></td><td>{row.partyName}</td><td>{row.partyTrn || "—"}</td><td className="amount">{money(row.taxableAmount)}</td><td><span className="badge">{row.taxRateName || "No VAT assigned"}</span><small className="vat-treatment">{row.taxTreatment?.replaceAll("_", " ") || "not assigned"}</small></td><td className="amount">{money(row.vatAmount)}</td><td className="amount">{money(row.grossAmount)}</td><td>{row.branchName || "Unassigned"}</td><td><Link className="record-link" href={`/accounting/journals/${row.journalId}`}>{row.journalNumber || "View JV"}</Link></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={11} className="empty">No posted VAT transactions match these filters.</td></tr>}
      </tbody></table></div>
    </section>
  );
}
