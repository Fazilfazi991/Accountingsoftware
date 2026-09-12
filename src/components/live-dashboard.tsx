"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getLiveDashboard, type DashboardActivity, type DashboardData } from "@/app/actions/dashboard";
import { useOrganizationContext } from "@/components/app-shell";
import "@/components/live-dashboard.module.css";

type DashboardIcon =
  | "bank"
  | "cash"
  | "receivable"
  | "payable"
  | "revenue"
  | "invoice"
  | "quotation"
  | "bill"
  | "expense"
  | "receipt"
  | "supplier"
  | "activity";

const money = (value: unknown) => value === null || value === undefined
  ? "—"
  : new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(Number(value || 0));

function DashboardGlyph({ name }: { name: DashboardIcon }) {
  const paths: Record<DashboardIcon, ReactNode> = {
    bank: <><path d="M3.5 8.5h17M5 8.5V19m4-10.5V19m6-10.5V19m4-10.5V19M3 19h18M12 3l9 4.5H3z" /></>,
    cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h4m-4 3h7m4 2h.01" /></>,
    receivable: <><path d="M5 3.5h11l3 3V20.5H5zM16 3.5v4h3" /><path d="M8 12h8m-8 4h5" /></>,
    payable: <><path d="M5 3.5h11l3 3V20.5H5zM16 3.5v4h3" /><path d="m9 12 2 2 4-4" /></>,
    revenue: <><path d="M4 19V11m5 8V6m5 13v-5m5 5V3" /><path d="m3 8 5-4 5 4 7-6" /></>,
    invoice: <><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
    quotation: <><path d="M5 4h14v16H5zM8 8h8m-8 4h5" /><path d="m14 15 2 2 3-4" /></>,
    bill: <><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6m-6 4h6m-6 4h6" /></>,
    expense: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8m-4-4v8" /></>,
    receipt: <><path d="M4 12h16M12 4v16" /><path d="m16 8 4 4-4 4M8 8l-4 4 4 4" /></>,
    supplier: <><path d="M4 7h16v13H4zM7 7V4h10v3" /><path d="M8 11h8m-8 4h5" /></>,
    activity: <path d="M4 18V9m5 9V5m5 13v-7m5 7V3" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-AE", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const activityIcon = (type: string): DashboardIcon => {
  if (type.includes("Invoice") || type.includes("Credit Note")) return "invoice";
  if (type.includes("Bill") || type.includes("Debit Note")) return "bill";
  if (type.includes("Receipt")) return "receipt";
  if (type.includes("Payment")) return "supplier";
  if (type.includes("Expense")) return "expense";
  return "activity";
};

function SectionHeader({ id, title, description, action }: { id: string; title: string; description: string; action?: ReactNode }) {
  return <div className="dashboard-section-head"><div><h2 id={id}>{title}</h2><p>{description}</p></div>{action}</div>;
}

function ActivityPulse({ activities, branchName }: { activities: DashboardActivity[]; branchName: string }) {
  const rows = activities.slice(0, 8);
  const largest = Math.max(...rows.map((row) => Math.abs(Number(row.amount))), 1);
  return (
    <section className="dashboard-surface dashboard-pulse" aria-labelledby="dashboard-pulse-title">
      <SectionHeader id="dashboard-pulse-title" title="Posted activity pulse" description={`Latest transaction values in ${branchName}`} action={<span className="dashboard-period">Latest {rows.length}</span>} />
      {rows.length ? (
        <div className="dashboard-pulse-chart" role="img" aria-label="Bar chart of the latest posted source-document values">
          {rows.map((row) => (
            <Link aria-label={`${row.type} ${row.document_number}, ${money(row.amount)}, ${row.date}`} className="dashboard-pulse-bar" href={row.href} key={`${row.type}-${row.document_id}`}>
              <span className="dashboard-pulse-amount">{money(row.amount)}</span>
              <span className="dashboard-pulse-track"><i style={{ height: `${Math.max((Math.abs(Number(row.amount)) / largest) * 100, 8)}%` }} /></span>
              <b title={row.document_number}>{row.document_number}</b>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty"><DashboardGlyph name="activity" /><div><b>No posted activity yet</b><span>Posted invoices, bills, payments, and expenses will appear here.</span></div></div>
      )}
    </section>
  );
}

function NeedsAttention({ data }: { data: DashboardData }) {
  const clear = data.receivable_count === 0 && data.payable_count === 0;
  return (
    <section className="dashboard-surface dashboard-attention" aria-labelledby="dashboard-attention-title">
      <SectionHeader id="dashboard-attention-title" title="Needs attention" description="Open balances worth reviewing" />
      {clear ? (
        <div className="dashboard-empty compact"><DashboardGlyph name="receivable" /><div><b>Nothing outstanding</b><span>This branch has no open invoices or bills.</span></div></div>
      ) : (
        <div className="dashboard-attention-list">
          {data.receivable_count > 0 && <Link href="/reports/accounts-receivable"><span className="dashboard-mini-icon receivable"><DashboardGlyph name="receivable" /></span><span><b>{data.receivable_count} open invoice{data.receivable_count === 1 ? "" : "s"}</b><small>Receivables to collect</small></span><strong>{money(data.receivables)}</strong></Link>}
          {data.payable_count > 0 && <Link href="/reports/accounts-payable"><span className="dashboard-mini-icon payable"><DashboardGlyph name="payable" /></span><span><b>{data.payable_count} open bill{data.payable_count === 1 ? "" : "s"}</b><small>Payables to schedule</small></span><strong>{money(data.payables)}</strong></Link>}
        </div>
      )}
    </section>
  );
}

const quickActions: readonly [string, string, DashboardIcon][] = [
  ["New Invoice", "/sales/invoices/new", "invoice"],
  ["New Quotation", "/sales/quotations/new", "quotation"],
  ["New Bill", "/purchases/bills/new", "bill"],
  ["Add Expense", "/expenses/new", "expense"],
  ["Receive Payment", "/sales/customer-payments/new", "receipt"],
  ["Pay Supplier", "/purchases/supplier-payments/new", "supplier"],
];

function QuickActions() {
  return (
    <section className="dashboard-surface dashboard-actions" aria-labelledby="dashboard-actions-title">
      <SectionHeader id="dashboard-actions-title" title="Quick actions" description="Start a frequent task" />
      <div className="dashboard-action-grid">
        {quickActions.map(([name, href, icon]) => <Link href={href} key={href}><span><DashboardGlyph name={icon} /></span><b>{name}</b></Link>)}
      </div>
    </section>
  );
}

function RecentActivity({ activities, branchName }: { activities: DashboardActivity[]; branchName: string }) {
  const rows = activities.slice(0, 6);
  return (
    <section className="dashboard-surface dashboard-recent" aria-labelledby="dashboard-recent-title">
      <SectionHeader id="dashboard-recent-title" title="Recent activity" description={`Latest posted documents for ${branchName}`} />
      {rows.length ? <ul>{rows.map((row) => (
        <li key={`${row.type}-${row.document_id}`}>
          <Link href={row.href}>
            <span className="dashboard-activity-icon"><DashboardGlyph name={activityIcon(row.type)} /></span>
            <span className="dashboard-activity-copy"><b>{row.type}</b><span>{row.document_number} · {row.party_reference || "No reference"}</span></span>
            <span className="dashboard-activity-meta"><strong>{money(row.amount)}</strong><time dateTime={row.date}>{row.date}</time></span>
          </Link>
        </li>
      ))}</ul> : <div className="dashboard-empty"><DashboardGlyph name="activity" /><div><b>No recent activity</b><span>Posted documents will appear here with their source links.</span></div></div>}
    </section>
  );
}

function CashAndBank({ data }: { data: DashboardData }) {
  const accounts = [...data.bank_accounts]
    .sort((a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance)))
    .slice(0, 3);
  return (
    <section className="dashboard-surface dashboard-accounts" aria-labelledby="dashboard-accounts-title">
      <SectionHeader id="dashboard-accounts-title" title="Cash & bank accounts" description="Posted ledger balances for the active branch" action={<Link href="/accounting/bank-accounts">View all accounts</Link>} />
      <div className="dashboard-account-grid">
        <Link href="/accounting/cash-accounts"><span className="dashboard-mini-icon cash"><DashboardGlyph name="cash" /></span><span><b>Cash on Hand</b><small>Cash account</small></span><strong>{money(data.cash_on_hand)}</strong></Link>
        {accounts.map((account) => <Link href="/accounting/bank-accounts" key={account.bank_account_id}><span className="dashboard-mini-icon bank"><DashboardGlyph name="bank" /></span><span><b title={account.name}>{account.name}</b><small>Bank account</small></span><strong>{money(account.balance)}</strong></Link>)}
        {!accounts.length && <Link className="dashboard-account-empty" href="/accounting/bank-accounts"><span className="dashboard-mini-icon bank"><DashboardGlyph name="bank" /></span><span><b>No active bank accounts</b><small>Add or activate a bank account</small></span></Link>}
      </div>
    </section>
  );
}

function DashboardLoading() {
  return <div className="dashboard-loading" aria-busy="true" aria-label="Loading dashboard"><div className="dashboard-primary-kpis">{[1, 2, 3, 4].map((item) => <span className="dashboard-skeleton-card" key={item} />)}</div><div className="dashboard-secondary-strip">{[1, 2, 3, 4].map((item) => <span className="dashboard-skeleton-line" key={item} />)}</div><div className="dashboard-main-grid"><div className="dashboard-command-column"><span className="dashboard-skeleton-panel short" /><span className="dashboard-skeleton-panel" /></div><div className="dashboard-insight-column"><span className="dashboard-skeleton-panel tall" /><span className="dashboard-skeleton-panel" /></div></div></div>;
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
    let active = true;
    void getLiveDashboard().then((result) => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else { setData(result); setError(""); }
    });
    return () => { active = false; };
  }, [branch.id, organization.id]);

  const primaryCards = data ? [
    { label: "Cash & Bank", value: Number(data.cash_on_hand) + Number(data.cash_at_bank), note: `${money(data.cash_on_hand)} cash · ${money(data.cash_at_bank)} bank`, href: "/reports/cash-flow", icon: "bank" as const, tone: "cash" },
    { label: "Receivables", value: data.receivables, note: `${data.receivable_count} open invoice${data.receivable_count === 1 ? "" : "s"}`, href: "/reports/accounts-receivable", icon: "receivable" as const, tone: "receivable" },
    { label: "Payables", value: data.payables, note: `${data.payable_count} open bill${data.payable_count === 1 ? "" : "s"}`, href: "/reports/accounts-payable", icon: "payable" as const, tone: "payable" },
    { label: "Revenue", value: data.month_revenue, note: data.month_revenue === null ? "P&L currently unavailable" : "Month to date · posted journals", href: "/reports/profit-loss", icon: "revenue" as const, tone: "revenue" },
  ] : [];
  const secondaryCards = data ? [
    { label: "Cash on hand", value: money(data.cash_on_hand), note: "Posted ledger" },
    { label: "Active banks", value: String(data.bank_account_count), note: "Available accounts" },
    { label: "Open invoices", value: String(data.receivable_count), note: "Awaiting settlement" },
    { label: "Open bills", value: String(data.payable_count), note: "Awaiting settlement" },
  ] : [];

  return <div className="live-dashboard">
    <div className="page-header dashboard-header"><div><h1>{greeting()}</h1><p>Here’s how {organization.name} is doing today in {branch.name}.</p></div><Link className="button" href="/sales/invoices/new">+ New Invoice</Link></div>
    {error && <section className="dashboard-surface dashboard-error"><div><h2>Dashboard unavailable</h2><p>{error}</p></div><button className="button secondary" onClick={() => void load()}>Retry</button></section>}
    {!data && !error && <DashboardLoading />}
    {data && <>
      <section className="dashboard-primary-kpis" aria-label="Primary financial position">
        {primaryCards.map((card) => <Link className={`dashboard-kpi-card ${card.tone}`} href={card.href} key={card.label}><span className="dashboard-kpi-head"><span>{card.label}</span><i><DashboardGlyph name={card.icon} /></i></span><strong>{money(card.value)}</strong><small>{card.note}</small></Link>)}
      </section>
      <section className="dashboard-secondary-strip" aria-label="Operational summary">
        {secondaryCards.map((card) => <div key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div>)}
      </section>
      <div className="dashboard-main-grid">
        <div className="dashboard-command-column"><NeedsAttention data={data} /><QuickActions /></div>
        <div className="dashboard-insight-column"><ActivityPulse activities={data.recent_activity} branchName={branch.name} /><RecentActivity activities={data.recent_activity} branchName={branch.name} /></div>
      </div>
      <CashAndBank data={data} />
    </>}
  </div>;
}
