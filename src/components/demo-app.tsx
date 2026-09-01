"use client";
/* eslint-disable react/jsx-key */

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateInvoice,
  journalDifference,
  type VatRate,
} from "@/demo/calculations";
import { DemoProvider, type Contact, useDemo } from "@/demo/store";
import {
  AppShell,
  OrganizationProvider,
  useOrganizationContext,
} from "@/components/app-shell";
import { AccountingMasters } from "@/components/accounting-masters";
import {
  EditJournal,
  JournalDetail as RealJournalDetail,
  MultiLineJournal,
  PostingReports,
} from "@/components/posting-reports";
import {
  createBranch,
  updateBranch,
  updateCompany,
} from "@/app/actions/organization";
import type { OrganizationContextPayload } from "@/lib/organization-context";
import { SettlementWorkflows } from "@/components/settlement-workflows";
import { SourceDocumentSettlements } from "@/components/source-document-settlements";
import { ExpenseWorkflow } from "@/components/expense-workflow";
import { StatementsReports } from "@/components/statements-reports";
import { LiveDashboard } from "@/components/live-dashboard";
import { InventoryWorkflow } from "@/components/inventory-workflow";
import { BusinessDocumentWorkflow } from "@/components/business-document-workflow";
import { VatReports } from "@/components/vat-reports";
import { FinancialStatements } from "@/components/financial-statements";
import { ControlsWorkspace } from "@/components/controls-workspace";
import { DocumentPrint } from "@/components/document-print";
import { SalesWorkflow } from "@/components/sales-workflow";

const groups = [
  ["", [["Home", "/"]]],
  [
    "IMS · Transactions",
    [
      ["Sales Invoice", "/sales/invoices"],
      ["Quotations", "/sales/quotations"],
      ["Delivery Notes", "/sales/delivery-notes"],
      ["Sales Return / Credit Note", "/sales/credit-notes"],
      ["Purchase Bill", "/purchases/bills"],
      ["Purchase Return / Debit Note", "/purchases/debit-notes"],
      ["Customer Receipt", "/sales/customer-payments"],
      ["Supplier Payment", "/purchases/supplier-payments"],
      ["Expenses", "/expenses"],
      ["Stock Opening", "/inventory/opening"],
      ["Stock Adjustment", "/inventory/adjustments"],
      ["Stock Transfer", "/inventory/transfers"],
    ],
  ],
  [
    "IMS · Reports",
    [
      ["Operational Reports", "/reports"],
      ["Customer Statement", "/reports/customer-statement"],
      ["Supplier Statement", "/reports/supplier-statement"],
      ["Accounts Receivable", "/reports/accounts-receivable"],
      ["Accounts Payable", "/reports/accounts-payable"],
      ["Stock Summary", "/reports/stock-summary"],
      ["Stock Movements", "/reports/stock-movements"],
      ["Inventory Valuation", "/reports/inventory-valuation"],
      ["Cost of Goods Sold", "/reports/cost-of-goods-sold"],
    ],
  ],
  [
    "IMS · Masters",
    [
      ["Customers", "/sales/customers"],
      ["Suppliers", "/purchases/suppliers"],
      ["Products & Services", "/products"],
      ["Stock Locations", "/inventory/locations"],
      ["Units", "/inventory/units"],
    ],
  ],
  [
    "Accounts · Transactions",
    [
      ["Opening Balances", "/accounting/opening-balances"],
      ["Journal Entry", "/accounting/journals"],
    ],
  ],
  [
    "Accounts · Reports",
    [
      ["Profit & Loss", "/reports/profit-loss"],
      ["Balance Sheet", "/reports/balance-sheet"],
      ["Cash Flow", "/reports/cash-flow"],
      ["Trial Balance", "/reports/trial-balance"],
      ["General Ledger", "/reports/general-ledger"],
      ["VAT Summary", "/reports/vat-summary"],
      ["VAT Transactions", "/reports/vat-transactions"],
    ],
  ],
  [
    "Accounts · Masters",
    [
      ["Accounting Masters", "/accounting/masters"],
      ["Chart of Accounts", "/accounting/chart-of-accounts"],
      ["Account Groups", "/accounting/account-groups"],
      ["Cash Accounts", "/accounting/cash-accounts"],
      ["Bank Accounts", "/accounting/bank-accounts"],
      ["VAT / Tax Rates", "/accounting/tax-rates"],
      ["Financial Years", "/accounting/financial-years"],
      ["Document Numbering", "/accounting/document-numbering"],
    ],
  ],
  [
    "Controls",
    [
      ["Settings", "/settings"],
      ["Audit Log", "/settings/audit-log"],
    ],
  ],
] as const;
const money = (n: number) =>
  `AED ${n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Button({
  children,
  href,
  secondary,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  href?: string;
  secondary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const c = `button ${secondary ? "secondary" : ""}`;
  return href ? (
    <Link className={c} href={href}>
      {children}
    </Link>
  ) : (
    <button className={c} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Header({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: [string, string];
}) {
  const { user, organization } = useOrganizationContext();
  const heading =
    title === "Good afternoon, Ahmed"
      ? `Good afternoon, ${user.displayName}`
      : title;
  const detail = description.replace("Horizon Trading LLC", organization.name);
  return (
    <div className="page-header">
      <div>
        <h1>{heading}</h1>
        <p>{detail}</p>
      </div>
      {action && <Button href={action[1]}>+ {action[0]}</Button>}
    </div>
  );
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ContactForm({ kind }: { kind: "customer" | "supplier" }) {
  const { addCustomer, addSupplier } = useDemo();
  const router = useRouter();
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "").trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    const contact: Omit<Contact, "id"> = {
      name,
      company: String(f.get("company") || name),
      email: String(f.get("email") || ""),
      phone: String(f.get("phone") || ""),
      emirate: String(f.get("emirate") || "Dubai"),
      trn: String(f.get("trn") || ""),
      terms: String(f.get("terms") || "Net 30"),
      notes: String(f.get("notes") || ""),
    };
    const id =
      kind === "customer" ? addCustomer(contact) : addSupplier(contact);
    router.push(
      `/${kind === "customer" ? "sales/customers" : "purchases/suppliers"}/${id}`,
    );
  }
  return (
    <>
      <Header
        title={`New ${kind}`}
        description="Demo-only contact data, stored in this browser."
      />
      <form onSubmit={submit} className="panel form-panel">
        <div className="form-grid">
          {[
            ["name", "Name"],
            ["company", "Company"],
            ["trn", "TRN"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["emirate", "Emirate"],
            ["terms", "Payment terms"],
            ["limit", "Credit limit"],
          ].map(([n, l]) => (
            <label key={n}>
              {l}
              <input
                name={n}
                defaultValue={
                  n === "emirate" ? "Dubai" : n === "terms" ? "Net 30" : ""
                }
              />
            </label>
          ))}
        </div>
        <label className="wide-label">
          Notes
          <textarea name="notes" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <Button
            secondary
            href={
              kind === "customer" ? "/sales/customers" : "/purchases/suppliers"
            }
          >
            Cancel
          </Button>
          <Button>Save {kind}</Button>
        </div>
      </form>
    </>
  );
}
function Contacts({ kind }: { kind: "customer" | "supplier" }) {
  const { customers, suppliers } = useDemo();
  const [query, setQuery] = useState("");
  const list = (kind === "customer" ? customers : suppliers).filter((c) =>
    `${c.name} ${c.emirate}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Header
        title={kind === "customer" ? "Customers" : "Suppliers"}
        description={`Manage ${kind} contacts and outstanding balances.`}
        action={[
          kind === "customer" ? "Customer" : "Supplier",
          kind === "customer"
            ? "/sales/customers/new"
            : "/purchases/suppliers/new",
        ]}
      />
      <section className="panel toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${kind}s...`}
        />
      </section>
      <section className="panel">
        <Table
          headers={["Name", "Emirate", "Email", "Terms"]}
          rows={list.map((c) => [
            <Link
              className="record-link"
              href={`/${kind === "customer" ? "sales/customers" : "purchases/suppliers"}/${c.id}`}
              key={c.id}
            >
              {c.name}
            </Link>,
            c.emirate,
            c.email || "—",
            c.terms,
          ])}
        />
      </section>
    </>
  );
}
function ContactDetail({
  kind,
  id,
}: {
  kind: "customer" | "supplier";
  id: string;
}) {
  const { customers, suppliers, invoices, allocatePayment } = useDemo();
  const router = useRouter();
  const c = (kind === "customer" ? customers : suppliers).find(
    (x) => x.id === id,
  );
  if (!c) return <Empty title={`${kind} not found`} />;
  const docs =
    kind === "customer" ? invoices.filter((i) => i.customerId === id) : [];
  const outstanding = docs.reduce(
    (a, i) => a + calculateInvoice(i.lines, i.amountPaid).balance,
    0,
  );
  return (
    <>
      <Header
        title={c.name}
        description={`${c.company} · ${c.emirate}`}
        action={[
          kind === "customer" ? "New invoice" : "New bill",
          kind === "customer" ? "/sales/invoices/new" : "/purchases/bills/new",
        ]}
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>Contact information</h2>
          <p>
            {c.email || "No email"} · {c.phone || "No phone"}
          </p>
          <p>TRN: {c.trn || "Not provided"}</p>
          <p>Terms: {c.terms}</p>
          <Button
            secondary
            onClick={() =>
              router.push(
                `/${kind === "customer" ? "sales/customers" : "purchases/suppliers"}`,
              )
            }
          >
            Back to list
          </Button>
        </section>
        <section className="metric">
          <span>
            {kind === "customer" ? "Receivable balance" : "Payable balance"}
          </span>
          <strong>{money(outstanding)}</strong>
          <small>Demo calculation</small>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{kind === "customer" ? "Invoices" : "Bills"}</h2>
            <p>Activity and open documents</p>
          </div>
        </div>
        {docs.length ? (
          <Table
            headers={["Number", "Status", "Total", "Balance", "Action"]}
            rows={docs.map((i) => {
              const t = calculateInvoice(i.lines, i.amountPaid);
              return [
                <Link
                  className="record-link"
                  href={`/sales/invoices/${i.id}`}
                  key={i.id}
                >
                  {i.number}
                </Link>,
                <span className="badge">{i.status}</span>,
                money(t.total),
                money(t.balance),
                t.balance > 0 ? (
                  <button
                    className="text-button"
                    onClick={() => allocatePayment(i.id, t.balance)}
                  >
                    Record full payment
                  </button>
                ) : (
                  "—"
                ),
              ];
            })}
          />
        ) : (
          <p className="empty">No documents for this demo contact yet.</p>
        )}
      </section>
    </>
  );
}
function InvoiceForm() {
  const { customers, products, addInvoice, postInvoice } = useDemo();
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [lines, setLines] = useState([
    {
      description: products[0]?.name || "Service",
      quantity: 1,
      rate: products[0]?.salesPrice || 0,
      discount: 0,
      vatRate: "standard" as VatRate,
    },
  ]);
  const [note, setNote] = useState("");
  const totals = calculateInvoice(lines);
  function save(post: boolean) {
    if (!customerId) return;
    const id = addInvoice({
      customerId,
      date: "2026-07-23",
      dueDate: "2026-08-22",
      status: post ? "Posted" : "Draft",
      lines,
      amountPaid: 0,
      notes: note,
    });
    if (post) postInvoice(id);
    router.push(`/sales/invoices/${id}`);
  }
  return (
    <>
      <Header
        title="New invoice"
        description="Demo-only invoice. Totals calculate locally and no ledger entry is created."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Customer
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Invoice date
            <input defaultValue="23 Jul 2026" />
          </label>
          <label>
            Due date
            <input defaultValue="22 Aug 2026" />
          </label>
          <label>
            Reference
            <input placeholder="Optional reference" />
          </label>
        </div>
        <div className="line-head">
          <h2>Items</h2>
          <button
            className="text-button"
            onClick={() =>
              setLines([
                ...lines,
                {
                  description: "New service",
                  quantity: 1,
                  rate: 0,
                  discount: 0,
                  vatRate: "standard",
                },
              ])
            }
          >
            + Add line
          </button>
        </div>
        <div className="line-editor">
          {lines.map((line, index) => (
            <div className="line-row" key={index}>
              <select
                value={line.description}
                onChange={(e) => {
                  const p = products.find((x) => x.name === e.target.value);
                  setLines(
                    lines.map((l, i) =>
                      i === index
                        ? {
                            ...l,
                            description: e.target.value,
                            rate: p?.salesPrice ?? l.rate,
                            vatRate: p?.vatRate ?? l.vatRate,
                          }
                        : l,
                    ),
                  );
                }}
              >
                {products.map((p) => (
                  <option key={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                aria-label="Quantity"
                type="number"
                value={line.quantity}
                onChange={(e) =>
                  setLines(
                    lines.map((l, i) =>
                      i === index
                        ? { ...l, quantity: Number(e.target.value) }
                        : l,
                    ),
                  )
                }
              />
              <input
                aria-label="Rate"
                type="number"
                value={line.rate}
                onChange={(e) =>
                  setLines(
                    lines.map((l, i) =>
                      i === index ? { ...l, rate: Number(e.target.value) } : l,
                    ),
                  )
                }
              />
              <select
                value={line.vatRate}
                onChange={(e) =>
                  setLines(
                    lines.map((l, i) =>
                      i === index
                        ? { ...l, vatRate: e.target.value as VatRate }
                        : l,
                    ),
                  )
                }
              >
                <option value="standard">VAT 5%</option>
                <option value="zero">Zero rated</option>
                <option value="exempt">Exempt</option>
                <option value="out-of-scope">Out of scope</option>
              </select>
              <button
                className="icon-button"
                aria-label="Remove line"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <label className="wide-label">
          Notes
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="totals">
          <span>
            Subtotal <b>{money(totals.subtotal)}</b>
          </span>
          <span>
            Discount <b>{money(totals.discount)}</b>
          </span>
          <span>
            VAT <b>{money(totals.vat)}</b>
          </span>
          <strong>
            Total <b>{money(totals.total)}</b>
          </strong>
        </div>
        <div className="form-actions">
          <Button secondary onClick={() => save(false)}>
            Save draft
          </Button>
          <Button onClick={() => save(true)}>Post mock invoice</Button>
        </div>
      </section>
    </>
  );
}
function InvoiceDetail({ id }: { id: string }) {
  const { invoices, customers, allocatePayment, postInvoice } = useDemo();
  const inv = invoices.find((i) => i.id === id);
  if (!inv) return <Empty title="Invoice not found" />;
  const customer = customers.find((c) => c.id === inv.customerId);
  const total = calculateInvoice(inv.lines, inv.amountPaid);
  return (
    <>
      <Header
        title={inv.number}
        description={`${customer?.name ?? "Customer"} · ${inv.date}`}
        action={
          inv.status === "Draft"
            ? ["Edit invoice", `/sales/invoices/new`]
            : undefined
        }
      />
      <section className="panel document">
        <div className="document-meta">
          <span className="badge">{inv.status}</span>
          <span>Due {inv.dueDate}</span>
        </div>
        <Table
          headers={["Description", "Qty", "Rate", "VAT", "Amount"]}
          rows={inv.lines.map((l) => [
            l.description,
            String(l.quantity),
            money(l.rate),
            l.vatRate === "standard" ? "5%" : "0%",
            money(calculateInvoice([l]).total),
          ])}
        />
        <div className="totals">
          <span>
            Subtotal <b>{money(total.subtotal)}</b>
          </span>
          <span>
            VAT <b>{money(total.vat)}</b>
          </span>
          <strong>
            Total <b>{money(total.total)}</b>
          </strong>
          <span>
            Amount paid <b>{money(inv.amountPaid)}</b>
          </span>
          <strong>
            Balance <b>{money(total.balance)}</b>
          </strong>
        </div>
        <p>Notes: {inv.notes || "—"}</p>
        <div className="form-actions">
          {inv.status === "Draft" && (
            <Button onClick={() => postInvoice(inv.id)}>
              Post mock invoice
            </Button>
          )}
          {total.balance > 0 && inv.status !== "Draft" && (
            <Button onClick={() => allocatePayment(inv.id, total.balance)}>
              Record full payment
            </Button>
          )}
          <Button secondary onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </section>
    </>
  );
}
function InvoiceList() {
  const { invoices, customers } = useDemo();
  const [query, setQuery] = useState("");
  const list = invoices.filter((i) =>
    `${i.number} ${customers.find((c) => c.id === i.customerId)?.name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <Header
        title="Invoices"
        description="Track invoices, payments and customer balances."
        action={["Invoice", "/sales/invoices/new"]}
      />
      <section className="panel toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoices..."
        />
      </section>
      <section className="panel">
        <Table
          headers={["Invoice", "Customer", "Status", "Total", "Balance"]}
          rows={list.map((i) => {
            const t = calculateInvoice(i.lines, i.amountPaid);
            return [
              <Link
                className="record-link"
                href={`/sales/invoices/${i.id}`}
                key={i.id}
              >
                {i.number}
              </Link>,
              customers.find((c) => c.id === i.customerId)?.name ?? "—",
              <span className="badge">{i.status}</span>,
              money(t.total),
              money(t.balance),
            ];
          })}
        />
      </section>
    </>
  );
}
function Payment() {
  const { customers, invoices, allocatePayment } = useDemo();
  const [id, setId] = useState(invoices[0]?.id || "");
  const inv = invoices.find((i) => i.id === id);
  const [amount, setAmount] = useState(0);
  const router = useRouter();
  if (!inv) return <Empty title="No open invoices" />;
  const due = calculateInvoice(inv.lines, inv.amountPaid).balance;
  return (
    <>
      <Header
        title="Customer payment"
        description="Allocate a demo receipt to an open invoice."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Customer
            <select value={inv.customerId} disabled>
              <option>
                {customers.find((c) => c.id === inv.customerId)?.name}
              </option>
            </select>
          </label>
          <label>
            Open invoice
            <select
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setAmount(0);
              }}
            >
              {invoices
                .filter(
                  (i) => calculateInvoice(i.lines, i.amountPaid).balance > 0,
                )
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Payment account
            <select>
              <option>Emirates NBD Current Account</option>
              <option>Cash on Hand</option>
            </select>
          </label>
          <label>
            Amount
            <input
              type="number"
              max={due}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="notice">
          Outstanding balance: <b>{money(due)}</b>
        </p>
        <div className="form-actions">
          <Button
            disabled={amount <= 0 || amount > due}
            onClick={() => {
              allocatePayment(id, amount);
              router.push(`/sales/invoices/${id}`);
            }}
          >
            Allocate payment
          </Button>
        </div>
      </section>
    </>
  );
}
function Banking() {
  const { cash, bank, addTransfer } = useDemo();
  const [amount, setAmount] = useState(0);
  return (
    <>
      <Header
        title="Banking"
        description="Cash and bank balances in the current demo session."
        action={["Reconciliation", "/banking/reconciliation"]}
      />
      <div className="metric-grid small-grid">
        <section className="metric">
          <span>Cash on hand</span>
          <strong>{money(cash)}</strong>
        </section>
        <section className="metric">
          <span>Emirates NBD</span>
          <strong>{money(bank)}</strong>
        </section>
      </div>
      <section className="panel form-panel">
        <h2>New transfer</h2>
        <div className="form-grid">
          <label>
            From
            <select>
              <option>Cash on Hand</option>
            </select>
          </label>
          <label>
            To
            <select>
              <option>Emirates NBD</option>
            </select>
          </label>
          <label>
            Amount
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <label>
            Reference
            <input placeholder="Optional" />
          </label>
        </div>
        <div className="form-actions">
          <Button
            disabled={amount <= 0 || amount > cash}
            onClick={() => addTransfer(amount)}
          >
            Record transfer
          </Button>
        </div>
      </section>
    </>
  );
}
function Journal() {
  const { journals, addJournal } = useDemo();
  const router = useRouter();
  const [lines, setLines] = useState([
    { account: "Office & Administration", debit: 0, credit: 0 },
    { account: "Emirates NBD Current Account", debit: 0, credit: 0 },
  ]);
  const difference = journalDifference(lines);
  function save(status: string) {
    const id = addJournal({
      date: "2026-07-23",
      reference: "MANUAL",
      description: "Manual journal",
      status,
      lines,
    });
    router.push(`/accounting/journals/${id}`);
  }
  return (
    <>
      <Header
        title="Journal entries"
        description="Mock manual journals; no accounting posting is performed."
      />
      <section className="panel">
        {journals.length > 0 && (
          <Table
            headers={["Journal", "Date", "Description", "Status"]}
            rows={journals.map((j) => [
              <Link
                className="record-link"
                href={`/accounting/journals/${j.id}`}
              >
                {j.number}
              </Link>,
              j.date,
              j.description,
              j.status,
            ])}
          />
        )}
      </section>
      <section className="panel form-panel">
        <div className="line-editor">
          {lines.map((l, i) => (
            <div className="line-row" key={i}>
              <input
                value={l.account}
                onChange={(e) =>
                  setLines(
                    lines.map((x, j) =>
                      j === i ? { ...x, account: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label="Debit"
                type="number"
                value={l.debit}
                onChange={(e) =>
                  setLines(
                    lines.map((x, j) =>
                      j === i ? { ...x, debit: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
              <input
                aria-label="Credit"
                type="number"
                value={l.credit}
                onChange={(e) =>
                  setLines(
                    lines.map((x, j) =>
                      j === i ? { ...x, credit: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
        <div className="totals">
          <span>
            Difference <b>{money(Math.abs(difference))}</b>
          </span>
        </div>
        <div className="form-actions">
          <Button secondary onClick={() => save("Draft")}>
            Save draft
          </Button>
          <Button disabled={difference !== 0} onClick={() => save("Posted")}>
            Post balanced journal
          </Button>
        </div>
      </section>
    </>
  );
}
function Dashboard() {
  const { totals, activity, invoices, customers, bills, products } = useDemo();
  const overdue = invoices
      .filter((i) => i.status === "Overdue")
      .reduce(
        (sum, i) => sum + calculateInvoice(i.lines, i.amountPaid).balance,
        0,
      ),
    low = products.filter(
      (p) => p.type === "Product" && p.stock <= p.reorderLevel,
    ).length;
  const metrics = [
    ["Sales", totals.sales, "This month · ↑ 8.4%", "sales"],
    ["Expenses", totals.expenses, "This month", "expense"],
    ["Cash & Bank", totals.cashBank, "Available funds", "cash"],
    [
      "Receivables",
      totals.receivables,
      overdue ? `${money(overdue)} overdue` : "All current",
      "receivable",
    ],
    ["Payables", totals.payables, "Supplier balances", "payable"],
    [
      "VAT Position",
      totals.vat,
      totals.vat >= 0
        ? "Payable · demo position"
        : "Recoverable · demo position",
      "vat",
    ],
  ] as const;
  const points = [42, 58, 49, 68, 61, 78],
    spend = [27, 32, 29, 36, 34, 39];
  return (
    <>
      <Header
        title="Good afternoon, Ahmed"
        description="Here’s what’s happening with Horizon Trading LLC."
        action={["New Invoice", "/sales/invoices/new"]}
      />
      <div className="metric-grid dashboard-metrics">
        {metrics.map(([label, value, note, tone]) => (
          <section className={`metric metric-${tone}`} key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <i>{label.charAt(0)}</i>
            </div>
            <strong>{money(value)}</strong>
            <small>{note}</small>
          </section>
        ))}
      </div>
      <div className="dashboard-primary">
        <section className="panel cashflow">
          <div className="panel-head">
            <div>
              <h2>Income vs expenses</h2>
              <p>Six-month cash-flow view</p>
            </div>
            <strong className="net-position">
              {money(totals.sales - totals.expenses)}
              <small>Net this month</small>
            </strong>
          </div>
          <div className="cash-chart" aria-label="Income and expenses chart">
            {["Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((month, index) => (
              <div className="chart-month" key={month}>
                <div className="chart-bars">
                  <i style={{ height: `${points[index]}%` }} />
                  <b style={{ height: `${spend[index]}%` }} />
                </div>
                <span>{month}</span>
              </div>
            ))}
          </div>
          <div className="chart-key">
            <span>
              <i />
              Income
            </span>
            <span>
              <b />
              Expenses
            </span>
            {low > 0 && (
              <Link href="/products">
                {low} item{low > 1 ? "s" : ""} low in stock
              </Link>
            )}
          </div>
        </section>
        <section className="panel quick-actions">
          <h2>Quick actions</h2>
          <p>Common bookkeeping tasks</p>
          <div>
            {[
              ["New Invoice", "/sales/invoices/new"],
              ["Record Payment", "/sales/customer-payments"],
              ["Add Expense", "/expenses/new"],
              ["Purchase Bill", "/purchases/bills/new"],
              ["New Customer", "/sales/customers/new"],
              ["Journal Entry", "/accounting/journals/new"],
            ].map(([name, href]) => (
              <Link key={href} href={href}>
                {name}
                <span>→</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-grid dashboard-bottom">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Open invoices</h2>
              <p>Prioritise balances needing attention</p>
            </div>
            <Link href="/sales/invoices">View all</Link>
          </div>
          <Table
            headers={["Invoice", "Customer", "Due date", "Status", "Balance"]}
            rows={invoices.slice(0, 5).map((i) => [
              <Link
                className="record-link"
                href={`/sales/invoices/${i.id}`}
                key={i.id}
              >
                {i.number}
              </Link>,
              customers.find((c) => c.id === i.customerId)?.name || "—",
              <span className={i.status === "Overdue" ? "due-overdue" : ""}>
                {i.dueDate}
              </span>,
              <span
                className={`badge ${i.status === "Overdue" ? "b-overdue" : ""}`}
              >
                {i.status}
              </span>,
              <span className="amount">
                {money(calculateInvoice(i.lines, i.amountPaid).balance)}
              </span>,
            ])}
          />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent activity</h2>
              <p>Latest workspace changes</p>
            </div>
          </div>
          <ul className="activity activity-timeline">
            {activity.slice(0, 5).map((x, i) => (
              <li key={i}>
                <i />
                <b>{x}</b>
                <span>
                  {i === 0 ? "Just now" : i === 1 ? "Today" : "Demo workspace"}
                </span>
              </li>
            ))}
            {bills.length > 0 && (
              <li>
                <i />
                <b>Supplier balances updated</b>
                <span>Purchase workflow</span>
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
function Reports({ name }: { name?: string }) {
  const { totals, invoices, bills } = useDemo();
  const report = name?.replaceAll("-", " ") || "Reports";
  if (!name)
    return (
      <>
        <Header
          title="Reports"
          description="Working demo reports with compact filters."
        />
        <div className="report-cards">
          {[
            "Profit & Loss",
            "Balance Sheet",
            "Trial Balance",
            "General Ledger",
            "Sales",
            "Purchases",
            "Expenses",
            "Receivables",
            "Payables",
            "Customer Statement",
            "Supplier Statement",
            "VAT Summary",
            "Stock Summary",
          ].map((x) => (
            <Link
              key={x}
              href={`/reports/${x.toLowerCase().replaceAll(" ", "-")}`}
              className="report-card"
            >
              <b>{x}</b>
              <span>Demo report</span>
            </Link>
          ))}
        </div>
      </>
    );
  const gross =
      totals.sales -
      bills.reduce((a, b) => a + calculateInvoice(b.lines).taxable, 0),
    net = gross - totals.expenses;
  return (
    <>
      <Header
        title={report.replace(/\b\w/g, (x) => x.toUpperCase())}
        description="Presentation-level report from current browser demo data."
      />
      <section className="panel toolbar">
        <input type="date" defaultValue="2026-07-01" />
        <input type="date" defaultValue="2026-07-31" />
        <select className="filter">
          <option>Dubai Main Branch</option>
        </select>
        <Button secondary>Apply</Button>
      </section>
      <section className="panel report">
        <div className="report-title">
          <b>{report.replace(/\b\w/g, (x) => x.toUpperCase())}</b>
          <small>Horizon Trading LLC · Demo data</small>
        </div>
        <div className="report-rows">
          {name === "profit-loss" ? (
            <>
              <b>Revenue</b>
              <p>
                <span>Sales & service income</span>
                <span>{money(totals.sales)}</span>
              </p>
              <b>Less cost of sales</b>
              <p>
                <span>Purchase costs (demo)</span>
                <span>{money(totals.sales - gross)}</span>
              </p>
              <strong>
                <span>Gross profit</span>
                <span>{money(gross)}</span>
              </strong>
              <b>Operating expenses</b>
              <p>
                <span>Expenses</span>
                <span>{money(totals.expenses)}</span>
              </p>
              <strong className="net">
                <span>Net profit</span>
                <span>{money(net)}</span>
              </strong>
            </>
          ) : (
            <>
              {[
                ["Sales", totals.sales],
                ["Receivables", totals.receivables],
                ["Payables", totals.payables],
                ["Cash & bank", totals.cashBank],
                ["Expenses", totals.expenses],
                ["VAT position", totals.vat],
              ].map(([x, v]) => (
                <p key={String(x)}>
                  <span>{x}</span>
                  <span>{money(Number(v))}</span>
                </p>
              ))}
              <strong>
                <span>Demo balance / total</span>
                <span>
                  {money(
                    totals.cashBank + totals.receivables - totals.payables,
                  )}
                </span>
              </strong>
            </>
          )}
        </div>
      </section>
      {["sales", "purchases", "receivables", "payables"].includes(name) && (
        <section className="panel">
          <Table
            headers={["Reference", "Status", "Total", "Balance"]}
            rows={[...invoices, ...bills].map((x) => [
              x.number,
              x.status,
              money(calculateInvoice(x.lines).total),
              money(calculateInvoice(x.lines, x.amountPaid).balance),
            ])}
          />
        </section>
      )}
    </>
  );
}
function QuotationForm() {
  const { customers, products, addQuotation } = useDemo();
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [productId, setProductId] = useState(products[0]?.id || "");
  const p = products.find((x) => x.id === productId);
  function save(status: string) {
    const id = addQuotation({
      customerId,
      date: "2026-07-23",
      expiry: "2026-08-22",
      status,
      lines: [
        {
          description: p?.name || "Item",
          productId,
          quantity: 1,
          rate: p?.salesPrice || 0,
          discount: 0,
          vatRate: p?.vatRate || "standard",
        },
      ],
      notes: "",
      terms: "Net 30",
    });
    router.push(`/sales/quotations/${id}`);
  }
  return (
    <>
      <Header
        title="New quotation"
        description="Build a customer quotation from active products and services."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Customer
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quotation number
            <input value="Auto-generated" disabled />
          </label>
          <label>
            Date
            <input defaultValue="2026-07-23" />
          </label>
          <label>
            Expiry
            <input defaultValue="2026-08-22" />
          </label>
          <label>
            Item / service
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products
                .filter((x) => x.active)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Quantity
            <input type="number" defaultValue="1" />
          </label>
        </div>
        <p className="notice">
          Rate {money(p?.salesPrice || 0)} · VAT{" "}
          {p?.vatRate === "standard" ? "5%" : "0%"}
        </p>
        <label className="wide-label">
          Notes / terms
          <textarea defaultValue="Net 30" />
        </label>
        <div className="form-actions">
          <Button secondary onClick={() => save("Draft")}>
            Save draft
          </Button>
          <Button onClick={() => save("Sent")}>Mark sent</Button>
        </div>
      </section>
    </>
  );
}
function QuotationDetail({ id }: { id: string }) {
  const { quotations, customers, quoteStatus, convertQuote } = useDemo();
  const router = useRouter();
  const q = quotations.find((x) => x.id === id);
  if (!q) return <Empty title="Quotation not found" />;
  const t = calculateInvoice(q.lines);
  return (
    <>
      <Header
        title={q.number}
        description={`${customers.find((c) => c.id === q.customerId)?.name || "Customer"} · expires ${q.expiry}`}
      />
      <section className="panel document">
        <span className="badge">{q.status}</span>
        <Table
          headers={["Description", "Qty", "Rate", "VAT", "Amount"]}
          rows={q.lines.map((l) => [
            l.description,
            String(l.quantity),
            money(l.rate),
            l.vatRate === "standard" ? "5%" : "0%",
            money(calculateInvoice([l]).total),
          ])}
        />
        <div className="totals">
          <strong>
            Total <b>{money(t.total)}</b>
          </strong>
        </div>
        <div className="form-actions">
          {q.status === "Draft" && (
            <Button secondary onClick={() => quoteStatus(id, "Sent")}>
              Mark sent
            </Button>
          )}
          {!["Converted", "Rejected", "Expired"].includes(q.status) && (
            <Button secondary onClick={() => quoteStatus(id, "Accepted")}>
              Accept
            </Button>
          )}
          {!["Converted", "Rejected", "Expired"].includes(q.status) && (
            <Button
              onClick={() => {
                const invoice = convertQuote(id);
                if (invoice) router.push(`/sales/invoices/${invoice}`);
              }}
            >
              Convert to invoice
            </Button>
          )}
        </div>
      </section>
    </>
  );
}
function BillForm() {
  const { suppliers, products, addBill, postBill } = useDemo();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [productId, setProductId] = useState(products[0]?.id || "");
  const p = products.find((x) => x.id === productId);
  function save(post: boolean) {
    const id = addBill({
      supplierId,
      reference: "SUP-REF-001",
      date: "2026-07-23",
      dueDate: "2026-08-22",
      status: post ? "Posted" : "Draft",
      lines: [
        {
          description: p?.name || "Expense",
          productId,
          quantity: 1,
          rate: p?.purchaseCost || 0,
          discount: 0,
          vatRate: p?.vatRate || "standard",
        },
      ],
      amountPaid: 0,
      notes: "",
    });
    if (post) postBill(id);
    router.push(`/purchases/bills/${id}`);
  }
  return (
    <>
      <Header
        title="New purchase bill"
        description="Create a demo supplier bill. Posting updates stock for tracked products."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Supplier
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier invoice reference
            <input defaultValue="SUP-REF-001" />
          </label>
          <label>
            Bill date
            <input defaultValue="2026-07-23" />
          </label>
          <label>
            Due date
            <input defaultValue="2026-08-22" />
          </label>
          <label>
            Item / expense
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products
                .filter((x) => x.active)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Cost
            <input type="number" value={p?.purchaseCost || 0} readOnly />
          </label>
        </div>
        <label className="wide-label">
          Notes
          <textarea />
        </label>
        <div className="form-actions">
          <Button secondary onClick={() => save(false)}>
            Save draft
          </Button>
          <Button onClick={() => save(true)}>Post bill</Button>
        </div>
      </section>
    </>
  );
}
function BillDetail({ id }: { id: string }) {
  const { bills, suppliers, postBill } = useDemo();
  const b = bills.find((x) => x.id === id);
  if (!b) return <Empty title="Purchase bill not found" />;
  const t = calculateInvoice(b.lines, b.amountPaid);
  return (
    <>
      <Header
        title={b.number}
        description={`${suppliers.find((s) => s.id === b.supplierId)?.name || "Supplier"} · ${b.reference}`}
      />
      <section className="panel document">
        <div className="document-meta">
          <span className="badge">{b.status}</span>
          <span>Due {b.dueDate}</span>
        </div>
        <Table
          headers={["Description", "Qty", "Cost", "VAT", "Amount"]}
          rows={b.lines.map((l) => [
            l.description,
            String(l.quantity),
            money(l.rate),
            l.vatRate === "standard" ? "5%" : "0%",
            money(calculateInvoice([l]).total),
          ])}
        />
        <div className="totals">
          <strong>
            Total <b>{money(t.total)}</b>
          </strong>
          <span>
            Paid <b>{money(b.amountPaid)}</b>
          </span>
          <strong>
            Balance <b>{money(t.balance)}</b>
          </strong>
        </div>
        <div className="form-actions">
          {b.status === "Draft" && (
            <Button onClick={() => postBill(id)}>Post bill</Button>
          )}
          {t.balance > 0 && b.status !== "Draft" && (
            <Button href="/purchases/supplier-payments">Record payment</Button>
          )}
          <Button secondary onClick={() => window.print()}>
            Print demo
          </Button>
        </div>
      </section>
    </>
  );
}
function SupplierPayment() {
  const { bills, suppliers, allocateSupplierPayment } = useDemo();
  const open = bills.filter(
    (b) => calculateInvoice(b.lines, b.amountPaid).balance > 0,
  );
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const total = Object.values(amounts).reduce((a, b) => a + b, 0);
  return (
    <>
      <Header
        title="Supplier payment"
        description="Allocate one demo payment across multiple open supplier bills."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Supplier
            <select>
              {suppliers.map((s) => (
                <option key={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Payment account
            <select>
              <option>Emirates NBD Current Account</option>
              <option>Cash on Hand</option>
            </select>
          </label>
          <label>
            Date
            <input defaultValue="2026-07-23" />
          </label>
          <label>
            Reference
            <input placeholder="Optional" />
          </label>
        </div>
        <Table
          headers={["Bill", "Supplier", "Open balance", "Allocate"]}
          rows={open.map((b) => [
            b.number,
            suppliers.find((s) => s.id === b.supplierId)?.name || "—",
            money(calculateInvoice(b.lines, b.amountPaid).balance),
            <input
              aria-label={`Allocate ${b.number}`}
              key={b.id}
              type="number"
              min="0"
              max={calculateInvoice(b.lines, b.amountPaid).balance}
              value={amounts[b.id] || ""}
              onChange={(e) =>
                setAmounts({ ...amounts, [b.id]: Number(e.target.value) })
              }
            />,
          ])}
        />
        <div className="totals">
          <strong>
            Total payment <b>{money(total)}</b>
          </strong>
        </div>
        <div className="form-actions">
          <Button
            disabled={total <= 0}
            onClick={() =>
              allocateSupplierPayment(
                Object.entries(amounts)
                  .filter(([, a]) => a > 0)
                  .map(([id, amount]) => ({ id, amount })),
              )
            }
          >
            Record payment
          </Button>
        </div>
      </section>
    </>
  );
}
function CreditNotes() {
  const { credits, invoices, customers, addCredit } = useDemo();
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id || "");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const inv = invoices.find((i) => i.id === invoiceId);
  return (
    <>
      <Header
        title="Credit notes"
        description="Credit eligible outstanding invoice value in this browser-only demo."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Source invoice
            <select
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            >
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <input
              value={
                customers.find((c) => c.id === inv?.customerId)?.name || ""
              }
              readOnly
            />
          </label>
          <label>
            Eligible balance
            <input
              value={money(
                inv ? calculateInvoice(inv.lines, inv.amountPaid).balance : 0,
              )}
              readOnly
            />
          </label>
          <label>
            Credit amount
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <label className="wide-label">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <Button
            disabled={!inv || amount <= 0}
            onClick={() => {
              if (inv) addCredit(inv.id, amount, reason, true);
            }}
          >
            Create credit note
          </Button>
        </div>
      </section>
      <section className="panel">
        <Table
          headers={["Credit note", "Customer", "Invoice", "Amount", "Reason"]}
          rows={credits.map((c) => [
            c.number,
            customers.find((x) => x.id === c.customerId)?.name || "—",
            invoices.find((x) => x.id === c.invoiceId)?.number || "—",
            money(c.amount),
            c.reason || "—",
          ])}
        />
      </section>
    </>
  );
}
function Products() {
  const { products, toggleProduct } = useDemo();
  const [query, setQuery] = useState("");
  const list = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Header
        title="Products & services"
        description="Products flow into new invoices, quotations and purchase bills."
        action={["Product", "/products/new"]}
      />
      <section className="panel toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products and services..."
        />
        <select className="filter">
          <option>All types</option>
          <option>Product</option>
          <option>Service</option>
        </select>
      </section>
      <section className="panel">
        <Table
          headers={[
            "Name",
            "SKU",
            "Type",
            "Sales price",
            "Stock",
            "Status",
            "Action",
          ]}
          rows={list.map((p) => [
            p.name,
            p.sku,
            p.type,
            money(p.salesPrice),
            p.type === "Product" ? (
              <span
                className={p.stock <= p.reorderLevel ? "badge b-overdue" : ""}
              >
                {p.stock}
                {p.stock <= p.reorderLevel ? " · Low" : ""}
              </span>
            ) : (
              "—"
            ),
            p.active ? "Active" : "Archived",
            <button className="text-button" onClick={() => toggleProduct(p.id)}>
              {p.active ? "Archive" : "Reactivate"}
            </button>,
          ])}
        />
      </section>
      <section className="panel">
        <h2>Stock movements</h2>
        <Table
          headers={[
            "Date",
            "Product",
            "Type",
            "Reference",
            "In",
            "Out",
            "Balance",
          ]}
          rows={products
            .filter((p) => p.type === "Product")
            .map((p) => [
              "2026-07-23",
              p.name,
              "Opening / demo",
              p.sku,
              "—",
              "—",
              p.stock,
            ])}
        />
      </section>
    </>
  );
}
function ProductForm({ onSave }: { onSave?: () => void }) {
  const { addProduct } = useDemo();
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addProduct({
      name: String(f.get("name")),
      type: String(f.get("type")) as "Product" | "Service",
      sku: String(f.get("sku")),
      category: String(f.get("category")),
      unit: String(f.get("unit")),
      salesPrice: Number(f.get("sales")),
      purchaseCost: Number(f.get("cost")),
      vatRate: "standard",
      stock: Number(f.get("stock")),
      reorderLevel: Number(f.get("reorder")),
      active: true,
    });
    onSave?.();
  }
  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Type
          <select name="type">
            <option>Product</option>
            <option>Service</option>
          </select>
        </label>
        <label>
          SKU
          <input name="sku" />
        </label>
        <label>
          Category
          <input name="category" defaultValue="General" />
        </label>
        <label>
          Unit
          <input name="unit" defaultValue="Each" />
        </label>
        <label>
          Sales price
          <input name="sales" type="number" defaultValue="0" />
        </label>
        <label>
          Purchase cost
          <input name="cost" type="number" defaultValue="0" />
        </label>
        <label>
          Opening stock
          <input name="stock" type="number" defaultValue="0" />
        </label>
        <label>
          Reorder level
          <input name="reorder" type="number" defaultValue="0" />
        </label>
      </div>
      <div className="form-actions">
        <Button>Save product</Button>
      </div>
    </form>
  );
}
function Accounts() {
  const { accounts, addAccount, toggleAccount } = useDemo();
  const [show, setShow] = useState(false);
  return (
    <>
      <Header
        title="Chart of accounts"
        description="Frontend demo chart. System accounts are protected from archive."
      />
      {show && (
        <section className="panel form-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              addAccount({
                code: String(f.get("code")),
                name: String(f.get("name")),
                type: String(f.get("type")),
                group: String(f.get("group")),
                description: String(f.get("description")),
                active: true,
              });
              setShow(false);
            }}
          >
            <div className="form-grid">
              <label>
                Account code
                <input name="code" required />
              </label>
              <label>
                Account name
                <input name="name" required />
              </label>
              <label>
                Account type
                <input name="type" defaultValue="Expense" />
              </label>
              <label>
                Parent group
                <select name="group">
                  {[
                    "Assets",
                    "Liabilities",
                    "Equity",
                    "Income",
                    "Cost of Sales",
                    "Expenses",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <input name="description" />
              </label>
            </div>
            <div className="form-actions">
              <Button>Save account</Button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Accounts</h2>
          <Button onClick={() => setShow(true)}>Add account</Button>
        </div>
        <Table
          headers={["Code", "Account", "Type", "Group", "Status", "Action"]}
          rows={accounts.map((a) => [
            a.code,
            a.name,
            a.type,
            a.group,
            a.system ? "System" : a.active ? "Active" : "Archived",
            a.system ? (
              "Protected"
            ) : (
              <button
                className="text-button"
                onClick={() => toggleAccount(a.id)}
              >
                {a.active ? "Archive" : "Reactivate"}
              </button>
            ),
          ])}
        />
      </section>
    </>
  );
}
function Vat() {
  const { invoices, bills, expenses, credits, customers, suppliers, totals } =
    useDemo();
  return (
    <>
      <Header
        title="VAT"
        description="Demo VAT position — preparation only, not FTA compliant."
      />
      <div className="metric-grid small-grid">
        <section className="metric">
          <span>Output VAT</span>
          <strong>{money(totals.outputVat)}</strong>
        </section>
        <section className="metric">
          <span>Input VAT</span>
          <strong>{money(totals.inputVat)}</strong>
        </section>
        <section className="metric">
          <span>Demo VAT Position</span>
          <strong>{money(totals.vat)}</strong>
          <small>{totals.vat >= 0 ? "VAT payable" : "VAT recoverable"}</small>
        </section>
      </div>
      <section className="panel">
        <h2>VAT transactions</h2>
        <Table
          headers={[
            "Date",
            "Reference",
            "Party",
            "Type",
            "Taxable",
            "VAT",
            "Input / Output",
            "Tax code",
          ]}
          rows={[
            ...invoices.map((i) => [
              i.date,
              i.number,
              customers.find((c) => c.id === i.customerId)?.name || "—",
              "Invoice",
              money(calculateInvoice(i.lines).taxable),
              money(calculateInvoice(i.lines).vat),
              "Output",
              "Standard",
            ]),
            ...bills.map((b) => [
              b.date,
              b.number,
              suppliers.find((s) => s.id === b.supplierId)?.name || "—",
              "Purchase bill",
              money(calculateInvoice(b.lines).taxable),
              money(calculateInvoice(b.lines).vat),
              "Input",
              "Standard",
            ]),
            ...expenses.map((e) => [
              e.date,
              "EXP",
              e.payee,
              "Expense",
              money(e.amount),
              money(e.amount * 0.05),
              "Input",
              "Standard",
            ]),
            ...credits.map((c) => [
              c.date,
              c.number,
              customers.find((x) => x.id === c.customerId)?.name || "—",
              "Credit note",
              money(c.amount / 1.05),
              money(c.amount / 21),
              "Output",
              "Standard",
            ]),
          ]}
        />
      </section>
      <section className="panel report">
        <div className="report-title">
          <b>VAT Return Preparation</b>
          <small>Preparation only — no FTA submission</small>
        </div>
        <div className="report-rows">
          <p>
            <span>Standard Rated Sales</span>
            <span>{money(totals.sales)}</span>
          </p>
          <p>
            <span>Output VAT</span>
            <span>{money(totals.outputVat)}</span>
          </p>
          <p>
            <span>Standard Rated Purchases</span>
            <span>
              {money(
                bills.reduce(
                  (a, b) => a + calculateInvoice(b.lines).taxable,
                  0,
                ),
              )}
            </span>
          </p>
          <p>
            <span>Input VAT</span>
            <span>{money(totals.inputVat)}</span>
          </p>
          <strong>
            <span>Net VAT</span>
            <span>{money(totals.vat)}</span>
          </strong>
        </div>
      </section>
    </>
  );
}
function Reconciliation() {
  const { statement, ledger, match, unmatch } = useDemo();
  const [selected, setSelected] = useState(statement[0]?.id || "");
  const row = statement.find((x) => x.id === selected);
  const matched = statement.filter((x) => x.matchedTo);
  const matchedTotal = matched.reduce((a, x) => a + Math.abs(x.amount), 0);
  return (
    <>
      <Header
        title="Bank reconciliation"
        description="Demo reconciliation only — no bank integration."
      />
      <div className="metric-grid small-grid">
        {[
          ["Statement balance", statement.reduce((a, x) => a + x.amount, 0)],
          ["Ledger balance", ledger.reduce((a, x) => a + x.amount, 0)],
          ["Matched total", matchedTotal],
          ["Unmatched transactions", statement.length - matched.length],
        ].map(([x, v]) => (
          <section className="metric" key={String(x)}>
            <span>{x}</span>
            <strong>{typeof v === "number" ? money(v) : v}</strong>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <h2>Bank statement transactions</h2>
          <Table
            headers={["Date", "Description", "Reference", "Amount", "Status"]}
            rows={statement.map((x) => [
              x.date,
              <button className="text-button" onClick={() => setSelected(x.id)}>
                {x.description}
              </button>,
              x.reference,
              money(x.amount),
              x.matchedTo ? (
                <span className="badge b-matched">Matched</span>
              ) : (
                <span className="badge b-unmatched">Unmatched</span>
              ),
            ])}
          />
        </section>
        <section className="panel">
          <h2>Ledgerly transactions</h2>
          <Table
            headers={[
              "Date",
              "Reference",
              "Description",
              "Account",
              "Amount",
              "Action",
            ]}
            rows={ledger.map((x) => [
              x.date,
              x.reference,
              x.description,
              "Emirates NBD",
              money(x.amount),
              row?.matchedTo === x.id ? (
                <button className="text-button" onClick={() => unmatch(row.id)}>
                  Unmatch
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={!row || Boolean(x.matchedTo)}
                  onClick={() => row && match(row.id, x.id)}
                >
                  Match
                </button>
              ),
            ])}
          />
        </section>
      </div>
    </>
  );
}
function DebitNotes() {
  const { bills, suppliers, debits, addDebit } = useDemo();
  const [billId, setBillId] = useState(bills[0]?.id || "");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const bill = bills.find((x) => x.id === billId);
  return (
    <>
      <Header
        title="Debit notes / purchase returns"
        description="Return eligible purchase-bill value in the browser demo."
      />
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            Supplier
            <input
              value={
                suppliers.find((s) => s.id === bill?.supplierId)?.name || ""
              }
              readOnly
            />
          </label>
          <label>
            Source bill
            <select value={billId} onChange={(e) => setBillId(e.target.value)}>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Returned line
            <input value={bill?.lines[0]?.description || ""} readOnly />
          </label>
          <label>
            Eligible amount
            <input
              value={money(
                bill
                  ? calculateInvoice(bill.lines, bill.amountPaid).balance
                  : 0,
              )}
              readOnly
            />
          </label>
          <label>
            Return value
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <div className="form-actions">
          <Button
            disabled={!bill || amount <= 0}
            onClick={() => bill && addDebit(bill.id, amount, reason, true)}
          >
            Create debit note
          </Button>
        </div>
      </section>
      <section className="panel">
        <Table
          headers={[
            "Debit note",
            "Supplier",
            "Source bill",
            "Date",
            "Amount",
            "Reason",
          ]}
          rows={debits.map((d) => [
            <Link
              className="record-link"
              href={`/purchases/debit-notes/${d.id}`}
            >
              {d.number}
            </Link>,
            suppliers.find((s) => s.id === d.supplierId)?.name || "—",
            bills.find((b) => b.id === d.billId)?.number || "—",
            d.date,
            money(d.amount),
            d.reason || "—",
          ])}
        />
      </section>
    </>
  );
}
function DebitDetail({ id }: { id: string }) {
  const { debits, bills, suppliers } = useDemo();
  const d = debits.find((x) => x.id === id);
  if (!d) return <Empty title="Debit note not found" />;
  return (
    <>
      <Header title={d.number} description="Purchase return · demo only" />
      <section className="panel document">
        <div className="document-meta">
          <span className="badge">Posted</span>
          <span>{d.date}</span>
        </div>
        <p>
          Supplier: <b>{suppliers.find((s) => s.id === d.supplierId)?.name}</b>
        </p>
        <p>
          Source bill: <b>{bills.find((b) => b.id === d.billId)?.number}</b>
        </p>
        <p>Reason: {d.reason || "—"}</p>
        <Table
          headers={["Returned line", "Quantity", "VAT", "Total"]}
          rows={[
            [
              d.line.description,
              String(d.line.quantity),
              d.line.vatRate === "standard" ? "5%" : "0%",
              money(d.amount),
            ],
          ]}
        />
        <div className="form-actions">
          <Button secondary onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </section>
    </>
  );
}
function JournalDetail({ id }: { id: string }) {
  const { journals } = useDemo();
  const j = journals.find((x) => x.id === id);
  if (!j) return <Empty title="Journal not found" />;
  const debit = j.lines.reduce((a, x) => a + x.debit, 0),
    credit = j.lines.reduce((a, x) => a + x.credit, 0);
  return (
    <>
      <Header title={j.number} description={`${j.description} · ${j.date}`} />
      <section className="panel document">
        <div className="document-meta">
          <span className="badge">{j.status}</span>
          <span>Reference {j.reference}</span>
        </div>
        <Table
          headers={["Account", "Debit", "Credit"]}
          rows={j.lines.map((x) => [
            x.account,
            money(x.debit),
            money(x.credit),
          ])}
        />
        <div className="totals">
          <span>
            Total debit <b>{money(debit)}</b>
          </span>
          <span>
            Total credit <b>{money(credit)}</b>
          </span>
          <strong>
            Difference <b>{money(Math.abs(debit - credit))}</b>
          </strong>
        </div>
        {debit === credit && <p className="notice">Balanced journal</p>}
      </section>
    </>
  );
}
function Statement({ kind }: { kind: "customer" | "supplier" }) {
  const { customers, suppliers, invoices, bills, credits, debits } = useDemo();
  const contacts = kind === "customer" ? customers : suppliers;
  const [id, setId] = useState(contacts[0]?.id || "");
  const docs =
    kind === "customer"
      ? invoices
          .filter((x) => x.customerId === id)
          .map((x) => ({
            date: x.date,
            ref: x.number,
            type: "Invoice",
            debit: calculateInvoice(x.lines).total,
            credit: x.amountPaid,
          }))
          .concat(
            credits
              .filter((x) => x.customerId === id)
              .map((x) => ({
                date: x.date,
                ref: x.number,
                type: "Credit note",
                debit: 0,
                credit: x.amount,
              })),
          )
      : bills
          .filter((x) => x.supplierId === id)
          .map((x) => ({
            date: x.date,
            ref: x.number,
            type: "Purchase bill",
            debit: calculateInvoice(x.lines).total,
            credit: x.amountPaid,
          }))
          .concat(
            debits
              .filter((x) => x.supplierId === id)
              .map((x) => ({
                date: x.date,
                ref: x.number,
                type: "Debit note",
                debit: 0,
                credit: x.amount,
              })),
          );
  const sorted = [...docs].sort((a, b) => a.date.localeCompare(b.date));
  const balances = sorted.map((_, index) =>
    sorted
      .slice(0, index + 1)
      .reduce((sum, item) => sum + item.debit - item.credit, 0),
  );
  const closing = balances.at(-1) || 0;
  const rows = sorted.map((x, index) => [
    x.date,
    x.ref,
    x.type,
    money(x.debit),
    money(x.credit),
    money(balances[index]),
  ]);
  return (
    <>
      <Header
        title={`${kind === "customer" ? "Customer" : "Supplier"} statement`}
        description="Current browser-demo activity."
      />
      <section className="panel toolbar">
        <select
          className="filter"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="date" defaultValue="2026-07-01" />
        <input type="date" defaultValue="2026-07-31" />
        <Button secondary onClick={() => window.print()}>
          Print
        </Button>
      </section>
      <section className="panel">
        <h2>{contacts.find((c) => c.id === id)?.name}</h2>
        <Table
          headers={[
            "Date",
            "Reference",
            "Transaction type",
            "Debit",
            "Credit",
            "Running balance",
          ]}
          rows={rows}
        />
        <div className="totals">
          <span>
            Total debit <b>{money(docs.reduce((a, x) => a + x.debit, 0))}</b>
          </span>
          <span>
            Total credit <b>{money(docs.reduce((a, x) => a + x.credit, 0))}</b>
          </span>
          <strong>
            Closing balance <b>{money(closing)}</b>
          </strong>
        </div>
      </section>
    </>
  );
}
function Settings() {
  const { settings, updateSettings, reset } = useDemo();
  const [confirm, setConfirm] = useState(false);
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    updateSettings({
      company: String(f.get("company")),
      email: String(f.get("email")),
      phone: String(f.get("phone")),
      terms: String(f.get("terms")),
      invoicePrefix: String(f.get("prefix")),
      nextNumber: Number(f.get("next")),
      vatRegistered: f.get("vat") === "on",
    });
  }
  return (
    <>
      <Header
        title="Settings"
        description="Frontend-only company and workspace preferences."
      />
      <form className="panel form-panel" onSubmit={save}>
        <h2>Company & invoice settings</h2>
        <div className="form-grid">
          <label>
            Company name
            <input name="company" defaultValue={settings.company} />
          </label>
          <label>
            Email
            <input name="email" defaultValue={settings.email} />
          </label>
          <label>
            Phone
            <input name="phone" defaultValue={settings.phone} />
          </label>
          <label>
            Emirate
            <input value={settings.emirate} readOnly />
          </label>
          <label>
            Invoice prefix
            <input name="prefix" defaultValue={settings.invoicePrefix} />
          </label>
          <label>
            Next number
            <input
              name="next"
              type="number"
              defaultValue={settings.nextNumber}
            />
          </label>
          <label>
            Default payment terms
            <input name="terms" defaultValue={settings.terms} />
          </label>
          <label>
            VAT registered
            <input
              name="vat"
              type="checkbox"
              defaultChecked={settings.vatRegistered}
            />
          </label>
        </div>
        <div className="form-actions">
          <Button>Save settings</Button>
        </div>
      </form>
      <section className="panel">
        <h2>Branches</h2>
        <Table
          headers={["Branch", "Code", "Location", "Status"]}
          rows={settings.branches.map((b) => [
            b.name,
            b.code,
            b.location,
            b.active ? "Active" : "Inactive",
          ])}
        />
        <h2>Users</h2>
        <Table
          headers={["Name", "Email", "Role", "Branch", "Status"]}
          rows={settings.users.map((u) => [
            u.name,
            u.email,
            u.role,
            u.branch,
            u.active ? "Active" : "Inactive",
          ])}
        />
        <h2>Categories & units</h2>
        <p>
          {settings.categories.join(" · ")} <br />
          {settings.units.join(" · ")}
        </p>
      </section>
      <section className="panel setting">
        <h2>Demo data</h2>
        <p>
          Restores all browser-local fixtures, including reconciliation and
          settings.
        </p>
        {confirm ? (
          <div className="form-actions">
            <Button secondary onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                reset();
                setConfirm(false);
              }}
            >
              Confirm reset
            </Button>
          </div>
        ) : (
          <Button secondary onClick={() => setConfirm(true)}>
            Reset Demo Data
          </Button>
        )}
      </section>
    </>
  );
}
function SettingsCompanySection() {
  const { organization } = useOrganizationContext();
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await updateCompany({
      name: String(form.get("name")),
      legalName: String(form.get("legalName")),
      currency: String(form.get("currency")),
      timezone: String(form.get("timezone")),
    });
    setMessage(result.error ?? "Company settings saved.");
  }
  return (
    <form className="panel form-panel" onSubmit={save}>
      <h2>Company settings</h2>
      <div className="form-grid">
        <label>
          Company Name
          <input name="name" defaultValue={organization.name} required />
        </label>
        <label>
          Legal Name
          <input name="legalName" defaultValue={organization.legalName} />
        </label>
        <label>
          Base Currency
          <select name="currency" defaultValue={organization.currency}>
            <option value="AED">AED</option>
          </select>
        </label>
        <label>
          Timezone
          <select name="timezone" defaultValue={organization.timezone}>
            <option value="Asia/Dubai">Asia/Dubai</option>
          </select>
        </label>
      </div>
      {message && (
        <p className={message.includes("Unable") ? "error" : "success"}>
          {message}
        </p>
      )}
      <div className="form-actions">
        <Button>Save company</Button>
      </div>
    </form>
  );
}
function SettingsBranchesSection() {
  const { branches, branch } = useOrganizationContext();
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  async function add() {
    const result = await createBranch(newName);
    setMessage(result.error ?? "Branch added.");
    if (!result.error) setNewName("");
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Branches</h2>
          <p>Real branches for the active organization.</p>
        </div>
      </div>
      <Table
        headers={["Branch", "Status", "Action"]}
        rows={branches.map((item) => [
          item.name,
          item.id === branch.id ? (
            <span className="badge b-posted">Active context</span>
          ) : (
            <span className="badge">Active</span>
          ),
          <div className="branch-actions">
            <button
              className="text-button"
              onClick={async () => {
                const name = window.prompt("Branch name", item.name);
                if (name) {
                  const result = await updateBranch({
                    id: item.id,
                    name,
                    active: true,
                  });
                  setMessage(result.error ?? "Branch updated.");
                }
              }}
            >
              Edit
            </button>
            <button
              className="text-button"
              onClick={async () => {
                const result = await updateBranch({
                  id: item.id,
                  name: item.name,
                  active: false,
                });
                setMessage(result.error ?? "Branch deactivated.");
              }}
            >
              Deactivate
            </button>
          </div>,
        ])}
      />
      <div className="branch-add">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New branch name"
        />
        <Button disabled={!newName.trim()} onClick={add}>
          Add branch
        </Button>
      </div>
      {message && (
        <p
          className={
            message.includes("Unable") || message.includes("final")
              ? "error"
              : "success"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}
void SettingsBranchesSection;
function SettingsBranchesSection2() {
  const { allBranches, branch } = useOrganizationContext();
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  async function change(id: string, name: string, active: boolean) {
    const result = await updateBranch({ id, name, active });
    setMessage(
      result.error ?? (active ? "Branch updated." : "Branch deactivated."),
    );
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Branches</h2>
          <p>Real branches for the active organization.</p>
        </div>
      </div>
      <Table
        headers={["Branch", "Status", "Action"]}
        rows={allBranches.map((item) => [
          item.name,
          item.active ? (
            <span className="badge b-posted">
              {item.id === branch.id ? "Active context" : "Active"}
            </span>
          ) : (
            <span className="badge">Inactive</span>
          ),
          <div className="branch-actions">
            <button
              className="text-button"
              onClick={async () => {
                const name = window.prompt("Branch name", item.name);
                if (name) await change(item.id, name, item.active);
              }}
            >
              Edit
            </button>
            <button
              className="text-button"
              onClick={() => change(item.id, item.name, !item.active)}
            >
              {item.active ? "Deactivate" : "Activate"}
            </button>
          </div>,
        ])}
      />
      <div className="branch-add">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New branch name"
        />
        <Button
          disabled={!newName.trim()}
          onClick={async () => {
            const result = await createBranch(newName);
            setMessage(result.error ?? "Branch added.");
            if (!result.error) setNewName("");
          }}
        >
          Add branch
        </Button>
      </div>
      {message && (
        <p
          className={
            message.includes("Unable") || message.includes("final")
              ? "error"
              : "success"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}
function RealSettings() {
  const { organization, branch } = useOrganizationContext();
  return (
    <>
      <Header
        title="Settings"
        description={`${organization.name} · ${branch.name}`}
      />
      <SettingsCompanySection />
      <SettingsBranchesSection2 />
      <section className="panel setting">
        <h2>Accounting demo data</h2>
        <p>
          Invoices, payments, VAT, inventory and reports remain sample browser
          data until Backend Phase 2.
        </p>
      </section>
    </>
  );
}
function Empty({ title }: { title: string }) {
  return (
    <section className="panel empty">
      <h1>{title}</h1>
      <p>This demo record is not available.</p>
    </section>
  );
}
function Content({ path }: { path: string[] }) {
  const route = path.join("/");
  if (route === "sales/invoices")
    return <SourceDocumentSettlements kind="invoice" />;
  if (route.startsWith("sales/invoices/") && route !== "sales/invoices/new")
    return <SourceDocumentSettlements kind="invoice" id={path[2]} />;
  if (route === "purchases/bills")
    return <SourceDocumentSettlements kind="bill" />;
  if (route.startsWith("purchases/bills/") && route !== "purchases/bills/new")
    return <SourceDocumentSettlements kind="bill" id={path[2]} />;
  if (route === "expenses") return <ExpenseWorkflow />;
  if (route === "expenses/new") return <ExpenseWorkflow mode="new" />;
  if (route.startsWith("expenses/"))
    return <ExpenseWorkflow id={path[1]} mode="detail" />;
  const settlementRoute = (
    prefix: string,
    kind: "credit" | "receipt" | "debit" | "payment",
  ) =>
    route === prefix ? (
      <SettlementWorkflows kind={kind} />
    ) : route === `${prefix}/new` ? (
      <SettlementWorkflows kind={kind} mode="new" />
    ) : route.startsWith(`${prefix}/`) ? (
      <SettlementWorkflows kind={kind} id={path[2]} mode="detail" />
    ) : null;
  const settlement =
    settlementRoute("sales/credit-notes", "credit") ||
    settlementRoute("sales/customer-payments", "receipt") ||
    settlementRoute("purchases/debit-notes", "debit") ||
    settlementRoute("purchases/supplier-payments", "payment");
  if (settlement) return settlement;
  const accountingPages = {
    "accounting/masters": "landing",
    "accounting/chart-of-accounts": "accounts",
    "accounting/account-groups": "groups",
    "accounting/cash-accounts": "cash",
    "accounting/bank-accounts": "bank",
    "accounting/tax-rates": "tax",
    "accounting/financial-years": "years",
    "accounting/document-numbering": "numbering",
    "accounting/opening-balances": "opening",
  } as const;
  if (route in accountingPages)
    return (
      <AccountingMasters
        page={accountingPages[route as keyof typeof accountingPages]}
      />
    );
  if (!route) return <LiveDashboard />;
  if (route === "sales/customers") return <Contacts kind="customer" />;
  if (route === "sales/customers/new") return <ContactForm kind="customer" />;
  if (route.startsWith("sales/customers/"))
    return <ContactDetail kind="customer" id={path[2]} />;
  if (route === "purchases/suppliers") return <Contacts kind="supplier" />;
  if (route === "purchases/suppliers/new")
    return <ContactForm kind="supplier" />;
  if (route.startsWith("purchases/suppliers/"))
    return <ContactDetail kind="supplier" id={path[2]} />;
  if (route === "sales/invoices/new") return <InvoiceForm />;
  if (route === "sales/quotations/new") return <QuotationForm />;
  if (route.startsWith("sales/quotations/"))
    return <QuotationDetail id={path[2]} />;
  if (route === "sales/quotations") return <Generic route={route} />;
  if (route === "purchases/bills/new") return <BillForm />;
  if (route === "products/new")
    return (
      <>
        <Header
          title="New product or service"
          description="Add an item available to new sales and purchase documents."
        />
        <section className="panel form-panel">
          <ProductForm />
        </section>
      </>
    );
  if (route === "products") return <Products />;
  if (route === "banking/reconciliation") return <Reconciliation />;
  if (route === "banking") return <Banking />;
  if (route.startsWith("accounting/journals/"))
    return <JournalDetail id={path[2]} />;
  if (route === "accounting/journals" || route === "accounting/journals/new")
    return <Journal />;
  if (route === "vat") return <Vat />;
  if (route === "settings") return <Settings />;
  if (route === "reports/customer-statement")
    return <Statement kind="customer" />;
  if (route === "reports/supplier-statement")
    return <Statement kind="supplier" />;
  if (route === "reports") return <Reports />;
  if (route.startsWith("reports/")) return <Reports name={path[1]} />;
  return <Generic route={route} />;
}
function Generic({ route }: { route: string }) {
  const { quotations, bills, customers, suppliers } = useDemo();
  if (route === "sales/quotations")
    return (
      <>
        <Header
          title="Quotations"
          description="Quotation fixtures are available for the demo."
        />
        <section className="panel">
          <Table
            headers={["Quotation", "Customer", "Expiry", "Status", "Total"]}
            rows={quotations.map((q) => [
              q.number,
              customers.find((c) => c.id === q.customerId)?.name ?? "—",
              q.expiry,
              <span className="badge">{q.status}</span>,
              money(calculateInvoice(q.lines).total),
            ])}
          />
        </section>
      </>
    );
  if (route === "purchases/bills")
    return (
      <>
        <Header
          title="Purchase bills"
          description="Supplier bills are available for review."
        />
        <section className="panel">
          <Table
            headers={["Bill", "Supplier", "Reference", "Status", "Balance"]}
            rows={bills.map((b) => [
              b.number,
              suppliers.find((s) => s.id === b.supplierId)?.name ?? "—",
              b.reference,
              <span className="badge">{b.status}</span>,
              money(calculateInvoice(b.lines, b.amountPaid).balance),
            ])}
          />
        </section>
      </>
    );
  const name = route
    .split("/")
    .map((x) => x.replaceAll("-", " "))
    .join(" · ");
  return (
    <>
      <Header
        title={name.replace(/\b\w/g, (x) => x.toUpperCase())}
        description="Demo screen — this feature remains UI-only in the current frontend phase."
      />
      {route === "settings" ? (
        <Settings />
      ) : (
        <section className="panel empty">
          <h2>{name}</h2>
          <p>
            This route is available for visual review. Its advanced workflow is
            clearly deferred.
          </p>
        </section>
      )}
    </>
  );
}
function App({ path }: { path: string[] }) {
  const route = `/${path.join("/")}`;
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const {
    customers,
    suppliers,
    invoices,
    quotations,
    bills,
    credits,
    products,
  } = useDemo();
  const results = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return [];
    return [
      ...customers.map((x) => [x.name, `/sales/customers/${x.id}`]),
      ...suppliers.map((x) => [x.name, `/purchases/suppliers/${x.id}`]),
      ...invoices.map((x) => [x.number, `/sales/invoices/${x.id}`]),
      ...quotations.map((x) => [x.number, `/sales/quotations/${x.id}`]),
      ...bills.map((x) => [x.number, `/purchases/bills/${x.id}`]),
      ...credits.map((x) => [x.number, "/sales/credit-notes"]),
      ...products.map((x) => [x.name, "/products"]),
    ]
      .filter((x) => x[0].toLowerCase().includes(q))
      .slice(0, 8);
  }, [
    search,
    customers,
    suppliers,
    invoices,
    quotations,
    bills,
    credits,
    products,
  ]);
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <b>Ledgerly</b>
        </div>
        <div className="company">
          <span>Horizon Trading LLC</span>
          <small>Dubai Main Branch</small>
        </div>
        <nav>
          {groups.map(([g, items]) => (
            <div className="nav-group" key={g}>
              {g && <p>{g}</p>}
              {items.map(([name, href]) => (
                <Link
                  className={
                    route === href || (href !== "/" && route.startsWith(href))
                      ? "active"
                      : ""
                  }
                  href={href}
                  key={href}
                >
                  {name}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="demo-label">Demo workspace · mock data only</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="search">
            ⌕{" "}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers, invoices, products…"
            />
            {results.length > 0 && (
              <div className="search-results">
                {results.map(([name, href]) => (
                  <Link
                    href={href}
                    onClick={() => setSearch("")}
                    key={`${name}${href}`}
                  >
                    {name}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="top-actions">
            <div className="quick">
              <Button onClick={() => setMenu(!menu)}>+ New</Button>
              {menu && (
                <div className="quick-menu">
                  {[
                    ["Customer", "/sales/customers/new"],
                    ["Supplier", "/purchases/suppliers/new"],
                    ["Quotation", "/sales/quotations/new"],
                    ["Invoice", "/sales/invoices/new"],
                    ["Purchase bill", "/purchases/bills/new"],
                    ["Expense", "/expenses/new"],
                    ["Customer payment", "/sales/customer-payments"],
                    ["Supplier payment", "/purchases/supplier-payments"],
                    ["Journal", "/accounting/journals/new"],
                  ].map(([n, h]) => (
                    <Link href={h} onClick={() => setMenu(false)} key={h}>
                      {n}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <button className="avatar">AR</button>
          </div>
        </header>
        <div className="content">
          <Content path={path} />
        </div>
      </main>
    </div>
  );
}
void App;
function ProductionUnavailable({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <>
      <Header title={title} description={detail} />
      <section className="panel empty">
        <h2>No production records</h2>
        <p>
          This module is intentionally unavailable instead of showing
          browser-local fixtures. It will be enabled only when its accounting
          workflow is backed by tenant-scoped server data.
        </p>
      </section>
    </>
  );
}
function OperationalReportIndex() {
  const reports: [string, string][] = [
    ["Customer Statement", "/reports/customer-statement"], ["Supplier Statement", "/reports/supplier-statement"],
    ["Accounts Receivable", "/reports/accounts-receivable"], ["Accounts Payable", "/reports/accounts-payable"],
    ["Stock Summary", "/reports/stock-summary"], ["Stock Movements", "/reports/stock-movements"],
    ["Inventory Valuation", "/reports/inventory-valuation"], ["Cost of Goods Sold", "/reports/cost-of-goods-sold"],
    ["Profit & Loss", "/reports/profit-loss"], ["Balance Sheet", "/reports/balance-sheet"],
    ["Cash Flow", "/reports/cash-flow"], ["Trial Balance", "/reports/trial-balance"],
    ["General Ledger", "/reports/general-ledger"], ["VAT Summary", "/reports/vat-summary"], ["VAT Transactions", "/reports/vat-transactions"],
  ];
  return (
    <>
      <Header
        title="Reports"
        description="Production reports backed by posted journals, open items, VAT and inventory ledgers."
      />
      <section className="report-cards">
        {reports.map(([name, href]) => (
          <Link className="report-card" href={href} key={href}>
            <b>{name}</b>
            <span>Open real report</span>
          </Link>
        ))}
      </section>
    </>
  );
}
function ContextualApp({ path }: { path: string[] }) {
  const [search, setSearch] = useState("");
  const route = path.join("/");
  const printKinds = [
    "invoice",
    "bill",
    "credit-note",
    "debit-note",
    "receipt",
    "payment",
    "expense",
    "quotation",
    "delivery-note",
  ];
  const print =
    path[0] === "documents" && printKinds.includes(path[1]) && path[2] ? (
      <DocumentPrint kind={path[1]} id={path[2]} />
    ) : null;
  const productionFallback =
    route === "reports" ? (
      <OperationalReportIndex />
    ) : route === "banking" || route === "banking/reconciliation" ? (
      <ProductionUnavailable
        title="Banking"
        detail="Bank transfer and reconciliation require a production bank-ledger workflow."
      />
    ) : null;
  const business =
    route === "sales/quotations" ? (
      <SalesWorkflow kind="quotation" mode="list" />
    ) : route === "sales/quotations/new" ? (
      <SalesWorkflow kind="quotation" mode="new" />
    ) : route === "sales/delivery-notes" ? (
      <SalesWorkflow kind="delivery_note" mode="list" />
    ) : route === "sales/delivery-notes/new" ? (
      <SalesWorkflow kind="delivery_note" mode="new" />
    ) : route === "sales/invoices" ? (
      <SalesWorkflow kind="invoice" mode="list" />
    ) : route === "sales/invoices/new" ? (
      <BusinessDocumentWorkflow kind="invoice" />
    ) : route === "purchases/bills/new" ? (
      <BusinessDocumentWorkflow kind="bill" />
    ) : route.startsWith("sales/invoices/") && route.endsWith("/edit") ? (
      <BusinessDocumentWorkflow kind="invoice" id={path[2]} />
    ) : route.startsWith("purchases/bills/") && route.endsWith("/edit") ? (
      <BusinessDocumentWorkflow kind="bill" id={path[2]} />
    ) : null;
  const inventory =
    route === "products" ? (
      <InventoryWorkflow mode="products" />
    ) : route === "products/new" ? (
      <InventoryWorkflow mode="product-new" />
    ) : route.startsWith("products/") ? (
      <InventoryWorkflow mode="product-detail" id={path[1]} />
    ) : route === "inventory/locations" ? (
      <InventoryWorkflow mode="locations" />
    ) : route === "inventory/units" ? (
      <InventoryWorkflow mode="units" />
    ) : route === "inventory/opening" ? (
      <InventoryWorkflow mode="opening" />
    ) : route === "inventory/adjustments" ? (
      <InventoryWorkflow mode="adjustment" />
    ) : route === "inventory/transfers" ? (
      <InventoryWorkflow mode="transfer" />
    ) : route === "reports/stock-summary" ? (
      <InventoryWorkflow mode="summary" />
    ) : route === "reports/stock-movements" ? (
      <InventoryWorkflow mode="movements" />
    ) : route === "reports/inventory-valuation" ? (
      <InventoryWorkflow mode="valuation" />
    ) : route === "reports/cost-of-goods-sold" ? (
      <InventoryWorkflow mode="cogs" />
    ) : null;
  const report =
    route === "accounting/journals" ? (
      <PostingReports view="journals" />
    ) : route === "accounting/journals/new" ? (
      <MultiLineJournal />
    ) : route.startsWith("accounting/journals/") && route.endsWith("/edit") ? (
      <EditJournal id={path[2]} />
    ) : route.startsWith("accounting/journals/") ? (
      <RealJournalDetail id={path[2]} />
    ) : route === "reports/trial-balance" ? (
      <PostingReports view="trial" />
    ) : route === "reports/general-ledger" ? (
      <PostingReports view="ledger" />
    ) : route === "reports/customer-statement" ? (
      <StatementsReports kind="customer" />
    ) : route === "reports/supplier-statement" ? (
      <StatementsReports kind="supplier" />
    ) : route === "reports/accounts-receivable" ? (
      <StatementsReports kind="ar" />
    ) : route === "reports/accounts-payable" ? (
      <StatementsReports kind="ap" />
    ) : route === "reports/vat-summary" || route === "vat" ? (
      <VatReports view="summary" />
    ) : route === "reports/vat-transactions" ? (
      <VatReports view="transactions" />
    ) : route === "reports/profit-loss" ? (
      <FinancialStatements view="profit-loss" />
    ) : route === "reports/balance-sheet" ? (
      <FinancialStatements view="balance-sheet" />
    ) : route === "reports/cash-flow" ? (
      <FinancialStatements view="cash-flow" />
    ) : null;
  return (
    <AppShell
      groups={groups}
      route={`/${route}`}
      topbar={
        <>
          <div className="search">
            ⌕{" "}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers, invoices, products…"
            />
          </div>
          <div className="top-actions">
            <Button href="/sales/invoices/new">+ New</Button>
          </div>
        </>
      }
    >
      {print ??
        (route === "settings" ? (
          <ControlsWorkspace view="settings" />
        ) : route === "settings/audit-log" ? (
          <ControlsWorkspace view="audit" />
        ) : route.startsWith("sales/customers") ? (
          <ControlsWorkspace view="customer" />
        ) : route.startsWith("purchases/suppliers") ? (
          <ControlsWorkspace view="supplier" />
        ) : (
          (business ??
          inventory ??
          report ??
          productionFallback ?? <Content path={path} />)
        ))}
    </AppShell>
  );
}
export function DemoApp({
  path,
  context,
}: {
  path: string[];
  context: OrganizationContextPayload;
}) {
  return (
    <OrganizationProvider context={context}>
      <DemoProvider>
        <ContextualApp path={path} />
      </DemoProvider>
    </OrganizationProvider>
  );
}
