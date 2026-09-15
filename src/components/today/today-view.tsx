import Link from "next/link";
import type { TodayData } from "@/lib/today/data";
import styles from "./today.module.css";

const money = (value: number, currency: string) => new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const number = (value: number, currency: string) => money(value, currency);

export function TodayView({ data }: { data: TodayData }) {
  const m = (value: number) => number(value, data.currency);
  const greeting = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: data.timezone }).format(new Date());
  const hour = Number(greeting);
  const dayLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${data.today}T12:00:00Z`));
  return <main className={styles.page}>
    <div className={styles.topline}><Link href="/" className={styles.brand}>Ledgerly <span>/ Today</span></Link><span>{data.organization} · {data.branch}</span><Link href="/" className={styles.back}>Dashboard ↗</Link></div>
    <header className={styles.header}><div><span className={styles.eyebrow}>{dayLabel}</span><h1>Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, {data.name}</h1>
      <p>{data.status}</p></div><div className={styles.headerRight}>{data.health && data.hasData && <div className={styles.health} aria-label={`Business health ${data.health.score} out of 100, ${data.health.label}`}>
        <span>BUSINESS HEALTH</span><b>{data.health.score}<small>/100</small></b><strong>{data.health.label}</strong></div>}</div></header>
    {data.warnings.length > 0 && <div className={styles.warning} role="status"><b>Some figures are unavailable.</b> {data.warnings.join(" ")}</div>}
    {!data.hasData && data.warnings.length === 0 && <div className={styles.empty}>Once you post an invoice, payment, bill, or expense, Today will highlight your financial position and next actions.</div>}
    <section className={styles.moneySection} aria-labelledby="money-title"><div className={styles.sectionHeading}><h2 id="money-title">Money now</h2><span>Posted balances · next 7 days</span></div>
      {data.money ? <><div className={styles.moneyGrid}>
        <div className={`${styles.metric} ${styles.cash}`}><span>Available cash + banks</span><strong>{m(data.money.now)}</strong><small>Posted-journal balance</small></div>
        <div className={styles.metric}><span>Coming in 7 days</span><strong className={styles.positive}>+ {m(data.money.coming)}</strong><Link href="/reports/accounts-receivable">Open customer invoices →</Link></div>
        <div className={styles.metric}><span>Going in 7 days</span><strong>− {m(data.money.going)}</strong><Link href="/reports/accounts-payable">Open supplier bills →</Link></div>
      </div><div className={styles.projection}><span>Simple 7-day projection <small>Cash + due customer invoices − due supplier bills</small></span><b>{m(data.money.projected)}</b></div></>
        : <p className={styles.unavailable}>Cash and due-date projection unavailable. Use the accounting reports for current balances.</p>}</section>
    <div className={styles.contentGrid}>
      <section className={`${styles.panel} ${styles.attention}`} aria-labelledby="attention-title"><div className={styles.panelHead}><h2 id="attention-title">Needs your attention</h2><span>{data.attention?.length ?? "—"}</span></div>
        {data.attention === null ? <p className={styles.unavailable}>Unable to verify open invoices and bills right now.</p>
          : data.attention.length === 0 ? <div className={styles.allGood}><b>You&apos;re all caught up ✓</b><p>No overdue invoices or bills need immediate attention.</p>
            {data.nextCollections !== null && data.nextCollections > 0 && <small>{m(data.nextCollections)} is due from customers in the next seven days.</small>}</div>
            : <div className={styles.attentionRows}>{data.attention.slice(0, 4).map((item, i) => <Link href={item.href} className={styles.actionRow} key={item.id}>
              <span className={`${styles.marker} ${i === 0 && item.title.includes("overdue") ? styles.urgent : ""}`}>{item.title.includes("overdue collection") ? "Collect" : "Pay"}</span>
              <span className={styles.rowText}><b>{item.title}</b><small>{item.detail}</small><em>{item.action} →</em></span><strong>{m(item.amount)}</strong></Link>)}
              {data.attention.length > 4 && <p className={styles.more}>{data.attention.length - 4} more open items in the AR/AP reports</p>}</div>}</section>
      <section className={styles.panel} aria-labelledby="pulse-title"><div className={styles.panelHead}><h2 id="pulse-title">Business pulse</h2><Link href="/reports/profit-loss">Profit &amp; Loss →</Link></div>
        {data.pulse ? <><div className={styles.pulseGrid}>
          <div><span>Ledger revenue MTD</span><b>{m(data.pulse.revenue.current)}</b><small>vs comparable prior month: {m(data.pulse.revenue.previous)}</small></div>
          <div><span>Ledger costs &amp; expenses MTD</span><b>{m(data.pulse.expenses.current)}</b><small>vs comparable prior month: {m(data.pulse.expenses.previous)}</small></div>
          <div><span>Ledger net result MTD</span><b>{m(data.pulse.netResult)}</b><small>Posted-journal P&amp;L, not an audited result</small></div>
          <div><span>Outstanding customer invoices</span><b>{data.pulse.outstanding === null ? "—" : m(data.pulse.outstanding)}</b><small>{data.pulse.overdue === null ? "Overdue portion unavailable" : `${m(data.pulse.overdue)} overdue`}</small></div>
        </div><p className={styles.explanation}>Revenue {data.pulse.revenue.difference >= 0 ? "increased" : "decreased"} {m(Math.abs(data.pulse.revenue.difference))} and ledger costs &amp; expenses {data.pulse.expenses.difference >= 0 ? "increased" : "decreased"} {m(Math.abs(data.pulse.expenses.difference))} vs the comparable days last month.</p></>
          : <p className={styles.unavailable}>Month-to-date ledger figures are unavailable.</p>}</section>
      <section className={styles.panel} aria-labelledby="activity-title"><div className={styles.panelHead}><h2 id="activity-title">Today&apos;s activity</h2><Link href="/reports">Reports →</Link></div>
        {data.activity ? <div className={styles.activityGrid}>
          <div><span>Received</span><b className={styles.positive}>+ {m(data.activity.received)}</b><small>Posted customer receipts</small></div>
          <div><span>Spent</span><b>− {m(data.activity.spent)}</b><small>Posted supplier payments + paid expenses</small></div>
          <div><span>Invoiced</span><b>{m(data.activity.invoiced)}</b><small>Posted sales invoices dated today</small></div>
          <div><span>Purchases</span><b>{m(data.activity.purchases)}</b><small>Posted purchase bills dated today</small></div>
        </div> : <p className={styles.unavailable}>Same-day posted activity cannot be verified right now.</p>}</section>
      <section className={styles.panel} aria-labelledby="upcoming-title"><div className={styles.panelHead}><h2 id="upcoming-title">Upcoming</h2><span>Next 7 days</span></div>
        {data.upcoming === null ? <p className={styles.unavailable}>Open-item due dates unavailable.</p>
          : data.upcoming.length === 0 ? <p className={styles.quiet}>No posted customer invoices or supplier bills fall due in the next seven days.</p>
            : <div className={styles.timeline}>{data.upcoming.map((item) => <Link href={item.href} key={`${item.kind}-${item.open_item_id}`}>
              <time dateTime={item.due_date || undefined}>{item.due_date === data.today ? "Today" : item.due_date}</time><span><b>{item.kind}</b><small>{item.party_name} · {item.document_number}</small></span><strong>{m(item.outstanding)}</strong></Link>)}</div>}</section>
    </div>
    <div className={styles.footerGrid}><section className={`${styles.panel} ${styles.recommendation}`} aria-labelledby="recommend-title"><span className={styles.eyebrow}>LEDGERLY RECOMMENDS · RULE-BASED</span><h2 id="recommend-title">{data.recommendation ? data.recommendation.heading : "Keep your collections on track"}</h2>
      <p>{data.recommendation ? `${m(data.recommendation.amount)} is open. ${data.recommendation.explanation}` : "No overdue customer invoice qualifies for a collection recommendation today."}</p>
      {data.recommendation && <Link href={data.recommendation.href} className={styles.button}>Review invoice →</Link>}</section>
      <section className={styles.quick} aria-labelledby="quick-title"><h2 id="quick-title">Quick create</h2><div>{[["Invoice", "/sales/invoices/new"], ["Quotation", "/sales/quotations/new"], ["Expense", "/expenses/new"], ["Bill", "/purchases/bills/new"], ["Payment received", "/sales/customer-payments"], ["Customer", "/sales/customers/new"]].map(([label, href]) => <Link key={href} href={href}>{label} <span>＋</span></Link>)}</div></section></div>
  </main>;
}
