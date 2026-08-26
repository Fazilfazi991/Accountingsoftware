"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getLiveDashboard, type DashboardActivity, type DashboardData } from "@/app/actions/dashboard";
import { useOrganizationContext } from "@/components/app-shell";
import "@/components/live-dashboard.module.css";

const money = (value: unknown) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));

function ActivityChart({ activities }: { activities: DashboardActivity[] }) {
  const rows = activities.slice(0, 5);
  if (!rows.length) return null;
  const largest = Math.max(...rows.map((row) => Number(row.amount)), 1);

  return (
    <section className="panel dashboard-chart">
      <div className="panel-head"><div><h2>Recent activity</h2><p>Posted transaction amounts</p></div></div>
      <div className="activity-bars">
        {rows.map((row) => (
          <Link className="activity-bar-row" href={row.href} key={`${row.type}-${row.document_id}`}>
            <span className="activity-bar-label"><b>{row.document_number}</b><small>{row.type}</small></span>
            <span className="activity-bar-track" aria-label={`${row.document_number}: ${money(row.amount)}`}><i style={{ width: `${Math.max((Number(row.amount) / largest) * 100, 8)}%` }} /></span>
            <strong>{money(row.amount)}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function LiveDashboard() {
  const { organization, branch } = useOrganizationContext();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await getLiveDashboard();
    if ("error" in result) setError(result.error);
    else { setData(result); setError(""); }
  }, []);

  useEffect(() => {
    void getLiveDashboard().then((result) => {
      if ("error" in result) setError(result.error);
      else { setData(result); setError(""); }
    });
  }, [organization.id, branch.id]);

  const cards = data ? [
    { label: "Cash on Hand", value: data.cash_on_hand, note: "Posted cash ledger balance", href: "/reports/general-ledger", tone: "cash" },
    { label: "Cash at Bank", value: data.cash_at_bank, note: `${data.bank_account_count} active bank account${data.bank_account_count === 1 ? "" : "s"}`, href: "/reports/general-ledger", tone: "bank" },
    { label: "Receivables", value: data.receivables, note: `${data.receivable_count} open invoice${data.receivable_count === 1 ? "" : "s"}`, href: "/reports/accounts-receivable", tone: "receivable" },
    { label: "Payables", value: data.payables, note: `${data.payable_count} open bill${data.payable_count === 1 ? "" : "s"}`, href: "/reports/accounts-payable", tone: "payable" },
  ] : [];

  return <>
    <div className="page-header"><div><h1>Good afternoon</h1><p>{organization.name} · {branch.name} live accounting position</p></div><Link className="button" href="/sales/invoices/new">+ New Invoice</Link></div>
    {error && <section className="panel dashboard-error"><p className="error">{error}</p><button className="button secondary" onClick={() => void load()}>Retry</button></section>}
    {!data && !error && <div className="metric-grid dashboard-metrics live-dashboard-metrics" aria-label="Loading live accounting balances">{[1, 2, 3, 4].map((item) => <section className="metric dashboard-skeleton" key={item}><span>Loading live balance…</span><strong>—</strong><small>Posted accounting data</small></section>)}</div>}
    {data && <>
      <div className="metric-grid dashboard-metrics live-dashboard-metrics">{cards.map((card) => <Link className={`metric dashboard-card metric-${card.tone}`} href={card.href} key={card.label}><div className="metric-top"><span>{card.label}</span></div><strong>{money(card.value)}</strong><small>{card.note}</small></Link>)}</div>
      <div className="dashboard-grid live-dashboard-grid">
        <section className="panel dashboard-activity"><div className="panel-head"><div><h2>Recent posted activity</h2><p>Latest source documents for {branch.name}</p></div></div>{data.recent_activity.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Party / reference</th><th>Amount</th><th>Journal</th></tr></thead><tbody>{data.recent_activity.map((row) => <tr key={`${row.type}-${row.document_id}`}><td>{row.date}</td><td>{row.type}</td><td><Link className="record-link" href={row.href}>{row.document_number}</Link></td><td>{row.party_reference || "—"}</td><td className="amount">{money(row.amount)}</td><td><Link className="record-link" href={`/accounting/journals/${row.journal_id}`}>View JV</Link></td></tr>)}</tbody></table></div> : <p className="empty">No posted activity in this branch yet.</p>}</section>
        <div className="dashboard-side"><section className="panel quick-actions"><h2>Quick actions</h2><p>Common bookkeeping tasks</p><div>{[["New Invoice", "/sales/invoices/new"], ["New Bill", "/purchases/bills/new"], ["New Expense", "/expenses/new"], ["Receive Payment", "/sales/customer-payments/new"], ["Pay Supplier", "/purchases/supplier-payments/new"]].map(([name, href]) => <Link key={href} href={href}>{name}<span>→</span></Link>)}</div></section><section className="panel bank-breakdown"><div className="panel-head"><div><h2>Bank balances</h2><p>Posted ledger balance by active account</p></div></div>{data.bank_accounts.length ? <ul>{data.bank_accounts.map((account) => <li key={account.bank_account_id}><span>{account.name}</span><strong>{money(account.balance)}</strong></li>)}</ul> : <p className="empty">No active bank accounts.</p>}</section></div>
      </div>
      <ActivityChart activities={data.recent_activity} />
    </>}
  </>;
}
