"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteBusinessDocument,
  postBusinessDocument,
} from "@/app/actions/business-documents";
import {
  getSettlementData,
  type SettlementData,
} from "@/app/actions/settlements";

const money = (value: unknown) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    Number(value || 0),
  );
const n = (value: unknown) => Number(value || 0);
const state = (item: any) =>
  !item
    ? "Settlement information unavailable"
    : n(item.remaining_amount) === 0
      ? "Paid"
      : n(item.remaining_amount) < n(item.original_amount)
        ? "Partially Paid"
        : "Unpaid";
const badge = (value: string) => (
  <span className={`badge b-${value.toLowerCase().replaceAll(" ", "-")}`}>
    {value}
  </span>
);

export function SourceDocumentSettlements({
  kind,
  id,
}: {
  kind: "invoice" | "bill";
  id?: string;
}) {
  const [data, setData] = useState<SettlementData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void getSettlementData().then((result) =>
      "error" in result ? setError(result.error) : setData(result),
    );
  }, []);
  if (error)
    return (
      <section className="panel">
        <p className="error">{error}</p>
      </section>
    );
  if (!data)
    return (
      <section className="panel">
        <p>Loading live settlement information…</p>
      </section>
    );
  const docs = kind === "invoice" ? data.invoices : data.bills;
  const document = docs.find((x: any) => x.id === id);
  return document ? (
    <Detail kind={kind} data={data} document={document} />
  ) : (
    <List kind={kind} data={data} />
  );
}
function List({
  kind,
  data,
}: {
  kind: "invoice" | "bill";
  data: SettlementData;
}) {
  const docs = kind === "invoice" ? data.invoices : data.bills;
  const party = kind === "invoice" ? data.customers : data.suppliers;
  const root = kind === "invoice" ? "/sales/invoices" : "/purchases/bills";
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{kind === "invoice" ? "Sales Invoices" : "Purchase Bills"}</h1>
          <p>Live outstanding balances from the AR/AP open-item model.</p>
        </div>
        <Link className="button" href={`${root}/new`}>
          + New
        </Link>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{kind === "invoice" ? "Invoice" : "Bill"}</th>
                <th>{kind === "invoice" ? "Customer" : "Supplier"}</th>
                <th>Date</th>
                <th>Total</th>
                <th>Outstanding</th>
                <th>Settlement status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc: any) => {
                const item = data.openItems.find(
                  (x: any) =>
                    x.source_document_id === doc.id &&
                    x.kind === (kind === "invoice" ? "receivable" : "payable"),
                );
                const label =
                  party.find(
                    (x) =>
                      x.id ===
                      doc[kind === "invoice" ? "customer_id" : "supplier_id"],
                  )?.name || "—";
                const s = doc.status === "draft" ? "Draft" : state(item);
                return (
                  <tr key={doc.id}>
                    <td>
                      <Link className="record-link" href={`${root}/${doc.id}`}>
                        {doc.invoice_number || doc.bill_number || "Draft"}
                      </Link>
                    </td>
                    <td>{label}</td>
                    <td>{doc.invoice_date || doc.bill_date}</td>
                    <td className="amount">{money(doc.grand_total)}</td>
                    <td className="amount">
                      {item ? money(item.remaining_amount) : "—"}
                    </td>
                    <td>{badge(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Detail({
  kind,
  data,
  document,
}: {
  kind: "invoice" | "bill";
  data: SettlementData;
  document: any;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const isInvoice = kind === "invoice";
  const root = isInvoice ? "/sales/invoices" : "/purchases/bills";
  const lines = (isInvoice ? data.invoiceLines : data.billLines).filter(
    (x: any) => x[isInvoice ? "invoice_id" : "bill_id"] === document.id,
  );
  const item = data.openItems.find(
    (x: any) =>
      x.source_document_id === document.id &&
      x.kind === (isInvoice ? "receivable" : "payable"),
  );
  const notes = (isInvoice ? data.creditNotes : data.debitNotes).filter(
    (x: any) =>
      x.status === "posted" &&
      x[isInvoice ? "invoice_id" : "bill_id"] === document.id,
  );
  const allocations = item
    ? data.allocations.filter((x: any) => x.open_item_id === item.id)
    : [];
  const payments = (isInvoice ? data.receipts : data.payments).filter(
    (x: any) =>
      x.status === "posted" &&
      allocations.some(
        (a: any) =>
          a[isInvoice ? "customer_receipt_id" : "supplier_payment_id"] === x.id,
      ),
  );
  const noteAmount = notes.reduce(
    (sum: number, x: any) => sum + n(x.grand_total),
    0,
  );
  const received = allocations
    .filter(
      (a: any) => a[isInvoice ? "customer_receipt_id" : "supplier_payment_id"],
    )
    .reduce((sum: number, x: any) => sum + n(x.amount), 0);
  const noteRoot = isInvoice ? "/sales/credit-notes" : "/purchases/debit-notes";
  const paymentRoot = isInvoice
    ? "/sales/customer-payments"
    : "/purchases/supplier-payments";
  const title = document.invoice_number || document.bill_number || "Draft";
  const run = async (work: Promise<any>, remove = false) => {
    setBusy(true);
    setNotice("");
    const result = await work;
    setBusy(false);
    if (result.error) setNotice(result.error);
    else if (remove) router.push(root);
    else window.location.reload();
  };
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>
            {isInvoice ? "Sales invoice" : "Purchase bill"} · live settlement
            and stock summary
          </p>
        </div>
        <div className="header-actions"><Link className="button secondary" href={root}>Back to list</Link>{document.status === "posted" && <Link className="button" href={`/documents/${isInvoice ? "invoice" : "bill"}/${document.id}/print`}>Print / PDF</Link>}</div>
      </div>
      <section className="panel">
        {notice && <p className="error">{notice}</p>}
        <div className="settlement-summary">
          <div>
            <span>{isInvoice ? "Invoice" : "Bill"} Total</span>
            <strong>{money(document.grand_total)}</strong>
          </div>
          <div>
            <span>{isInvoice ? "Credited" : "Debit notes / returns"}</span>
            <strong>{money(noteAmount)}</strong>
          </div>
          <div>
            <span>{isInvoice ? "Received" : "Supplier payments"}</span>
            <strong>{money(received)}</strong>
          </div>
          <div>
            <span>Outstanding</span>
            <strong>
              {item ? money(item.remaining_amount) : "Unavailable"}
            </strong>
          </div>
          <div>
            <span>Settlement Status</span>
            <strong>
              {badge(document.status === "draft" ? "Draft" : state(item))}
            </strong>
          </div>
        </div>
        {document.status === "posted" && !item && (
          <p className="error">Settlement information unavailable</p>
        )}
        {document.posted_journal_id && (
          <p className="posted-journal">
            Posted Journal:{" "}
            <Link
              className="record-link"
              href={`/accounting/journals/${document.posted_journal_id}`}
            >
              View JV
            </Link>
          </p>
        )}
        {document.status === "draft" && (
          <div className="form-actions">
            <Link
              className="button secondary"
              href={`${root}/${document.id}/edit`}
            >
              Edit draft
            </Link>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(deleteBusinessDocument(kind, document.id), true)
              }
            >
              Delete draft
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(postBusinessDocument(kind, document.id))}
            >
              {busy ? "Working…" : "Post"}
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Document lines</h2>
            <p>Canonical product, unit, and stock location provenance.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / service</th>
                <th>Unit</th>
                <th>Location</th>
                <th>Quantity</th>
                <th>Unit price</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line: any) => {
                const product = data.products.find(
                  (x: any) => x.id === line.product_id,
                );
                const location = data.locations.find(
                  (x: any) => x.id === line.inventory_location_id,
                );
                return (
                  <tr key={line.id}>
                    <td>
                      {product ? (
                        <Link
                          className="record-link"
                          href={`/products/${product.id}`}
                        >
                          {product.sku} · {product.name}
                        </Link>
                      ) : (
                        line.description
                      )}
                    </td>
                    <td>{product?.inventory_units?.code || "—"}</td>
                    <td>{location?.name || "—"}</td>
                    <td>{n(line.quantity)}</td>
                    <td className="amount">{money(line.unit_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Activity
        title="Related settlement activity"
        rows={[
          ...notes.map((x: any) => ({
            id: x.id,
            href: `${noteRoot}/${x.id}`,
            number:
              x.credit_note_number || x.debit_note_number || "Posted note",
            date: x.credit_note_date || x.debit_note_date,
            amount: x.grand_total,
            label: isInvoice ? "Credit Note" : "Debit Note",
          })),
          ...payments.map((x: any) => ({
            id: x.id,
            href: `${paymentRoot}/${x.id}`,
            number: x.receipt_number || x.payment_number || "Posted payment",
            date: x.receipt_date || x.payment_date,
            amount: x.amount,
            label: isInvoice ? "Customer Receipt" : "Supplier Payment",
          })),
        ]}
      />
    </>
  );
}
function Activity({ title, rows }: { title: string; rows: any[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>Posted activity related to this open item.</p>
        </div>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Document</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.label}</td>
                  <td>
                    <Link className="record-link" href={row.href}>
                      {row.number}
                    </Link>
                  </td>
                  <td>{row.date}</td>
                  <td className="amount">{money(row.amount)}</td>
                  <td>{badge("Posted")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No posted settlement activity yet.</p>
      )}
    </section>
  );
}
