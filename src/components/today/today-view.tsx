import Link from "next/link";
import type { TodayData } from "@/lib/today/data";
import styles from "./today.module.css";

const money = (value: number, currency: string) => new Intl.NumberFormat("en-AE", { style: "currency", currency,
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
const number = (value: number, currency: string) => money(value, currency);

export function TodayView({ data }: { data: TodayData }) {
  const m = (value: number) => number(value, data.currency);
  const greeting = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: data.timezone }).format(new Date());
  const hour = Number(greeting);
  const dayLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${data.today}T12:00:00Z`));
  const displayName = /@|(?:-[a-z0-9]+){3,}/i.test(data.name) ? "there" : data.name;
  return <div className={styles.page}>
    <div className={styles.topline}><Link href="/" className={styles.brand}>Ledgerly <span>/ Today</span></Link><span>{data.organization} · {data.branch}</span><Link href="/overview" className={styles.back}>Financial Overview ↗</Link></div>
    <header className={styles.header}><div className={styles.headerCopy}><h1>Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, {displayName}</h1>
      <p>{data.status}</p><small className={styles.scope}>{dayLabel} <span aria-hidden="true">·</span> {data.organization} / {data.branch}</small></div><div className={styles.headerRight}>{data.health && data.hasData && <div className={styles.health} aria-label={`Business health ${data.health.score} out of 100, ${data.health.label}`}>
        <span>Business health</span><b>{data.health.score}<small>/100</small></b><strong>{data.health.label}</strong></div>}</div></header>
    {data.warnings.length > 0 && <div className={styles.warning} role="status"><b>Some figures are unavailable.</b> {data.warnings.join(" ")}</div>}
    {!data.hasData && data.warnings.length === 0 && <div className={styles.empty}>Once you post an invoice, payment, bill, or expense, Today will highlight your financial position and next actions.</div>}
    <section className={styles.moneySection} aria-labelledby="money-title"><div className={styles.sectionHeading}><h2 id="money-title">Money now</h2><span>Posted balances · next 7 days</span></div>
      {data.money ? <><div className={styles.moneyGrid}>
        <div className={`${styles.metric} ${styles.cash}`}><span>Cash now <small>Cash + bank</small></span><strong>{m(data.money.now)}</strong><small>Posted-journal balance</small></div>
        <div className={styles.metric}><span>Coming in <small>Next 7 days</small></span><strong className={styles.positive}>+ {m(data.money.coming)}</strong><Link href="/reports/accounts-receivable">Customer invoices →</Link></div>
        <div className={styles.metric}><span>Going out <small>Next 7 days</small></span><strong>− {m(data.money.going)}</strong><Link href="/reports/accounts-payable">Supplier bills →</Link></div>
        <div className={`${styles.metric} ${styles.projected}`}><span>Projected cash <small>In 7 days</small></span><strong>{m(data.money.projected)}</strong><small>Cash + due in − due out</small></div>
      </div><p className={styles.moneyNote}>Projection uses posted balances and due open items; it is not a cash forecast.</p></>
        : <p className={styles.unavailable}>Cash and due-date projection unavailable. Use the accounting reports for current balances.</p>}</section>
    <div className={styles.contentGrid}>
      <section className={`${styles.panel} ${styles.attention}`} aria-labelledby="attention-title"><div className={styles.panelHead}><h2 id="attention-title">Needs your attention</h2><span>{data.attention === null ? "Unavailable" : `${data.attention.length} items`}</span></div>
        {data.attention === null ? <p className={styles.unavailable}>Unable to verify open invoices and bills right now.</p>
          : data.attention.length === 0 ? <div className={styles.allGood}><b>You&apos;re all caught up ✓</b><p>No overdue invoices or bills need immediate attention.</p>
            {data.nextCollections !== null && data.nextCollections > 0 && <small>{m(data.nextCollections)} is due from customers in the next seven days.</small>}</div>
            : <><div className={styles.attentionRows}>{data.attention.slice(0, 4).map((item, index) => <Link href={item.href} className={`${styles.actionRow} ${index === 0 ? styles.firstAction : ""}`} key={item.id}>
              <span className={`${styles.marker} ${item.title.includes("overdue collection") ? styles.urgent : ""}`}>{item.title.includes("overdue collection") ? "Collect" : "Pay"}</span>
              <span className={styles.rowText}><b>{item.title}</b><small>{item.detail}</small><em>{item.action} →</em></span><strong>{m(item.amount)}</strong></Link>)}</div>{data.attention.length > 4 && <p className={styles.more}>Showing the first 4 of {data.attention.length} ranked items.</p>}</>}</section>
      <section className={`${styles.panel} ${styles.recommendation}`} aria-labelledby="recommend-title"><h2 id="recommend-title">Ledgerly recommends</h2>
        <p className={styles.recommendLead}>{data.recommendation ? `Collect ${m(data.recommendation.amount)} from ${data.recommendation.title.split(" · ")[0]} today.` : "Keep your collections on track"}</p>
        <p>{data.recommendation ? data.recommendation.explanation : "No overdue customer invoice qualifies for a collection recommendation today."}</p>
        {data.recommendation && <Link href={data.recommendation.href} className={styles.button}>Review invoice →</Link>}<small>Based on posted open invoices, not AI advice</small></section>
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
    <section className={styles.quick} aria-labelledby="quick-title"><h2 id="quick-title">Quick create</h2><div>{[["Invoice", "/sales/invoices/new"], ["Quotation", "/sales/quotations/new"], ["Expense", "/expenses/new"], ["Bill", "/purchases/bills/new"], ["Payment received", "/sales/customer-payments"], ["Customer", "/sales/customers/new"]].map(([label, href]) => <Link key={href} href={href}>{label} <span>＋</span></Link>)}</div></section>
  </div>;
}
