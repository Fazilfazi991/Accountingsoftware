"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCreditNote,
  deleteDebitNote,
  deleteReceipt,
  deleteSupplierPayment,
  getSettlementData,
  postCreditNote,
  postDebitNote,
  postReceipt,
  postSupplierPayment,
  saveCreditNote,
  saveDebitNote,
  saveReceipt,
  saveSupplierPayment,
  type SettlementData,
} from "@/app/actions/settlements";

type Kind = "credit" | "receipt" | "debit" | "payment";
const AED = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
});
const money = (value: unknown) => AED.format(Number(value || 0));
const n = (value: unknown) => Number(value || 0);
const today = new Date().toISOString().slice(0, 10);
const title: Record<Kind, string> = {
  credit: "Sales Credit Notes",
  receipt: "Customer Receipts",
  debit: "Purchase Debit Notes",
  payment: "Supplier Payments",
};
const pathFor: Record<Kind, string> = {
  credit: "/sales/credit-notes",
  receipt: "/sales/customer-payments",
  debit: "/purchases/debit-notes",
  payment: "/purchases/supplier-payments",
};
const status = (remaining: number, original: number) =>
  remaining <= 0 ? "Paid" : remaining < original ? "Partially Paid" : "Unpaid";
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={`badge b-${String(children).toLowerCase().replaceAll(" ", "-")}`}
    >
      {children}
    </span>
  );
}

export function SettlementWorkflows({
  kind,
  id,
  mode = "list",
}: {
  kind: Kind;
  id?: string;
  mode?: "list" | "new" | "detail";
}) {
  const [data, setData] = useState<SettlementData | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    const result = await getSettlementData();
    if ("error" in result) setError(result.error);
    else {
      setData(result);
      setError("");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <section className="panel">
        <h1>{title[kind]}</h1>
        <p className="error">{error}</p>
        <button className="button secondary" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="panel">
        <p>Loading live settlement data…</p>
      </section>
    );
  const rows =
    kind === "credit"
      ? data.creditNotes
      : kind === "receipt"
        ? data.receipts
        : kind === "debit"
          ? data.debitNotes
          : data.payments;
  const record = rows.find((x) => x.id === id);
  if (mode === "new" || record)
    return (
      <SettlementForm kind={kind} data={data} record={record} reload={load} />
    );
  return <SettlementList kind={kind} data={data} />;
}

function SettlementList({ kind, data }: { kind: Kind; data: SettlementData }) {
  const rows =
    kind === "credit"
      ? data.creditNotes
      : kind === "receipt"
        ? data.receipts
        : kind === "debit"
          ? data.debitNotes
          : data.payments;
  const party = (row: any) =>
    (kind === "credit" || kind === "receipt"
      ? data.customers
      : data.suppliers
    ).find((x) => x.id === row.customer_id || x.id === row.supplier_id)?.name ||
    "—";
  const dateKey =
    kind === "credit"
      ? "credit_note_date"
      : kind === "receipt"
        ? "receipt_date"
        : kind === "debit"
          ? "debit_note_date"
          : "payment_date";
  const numberKey =
    kind === "credit"
      ? "credit_note_number"
      : kind === "receipt"
        ? "receipt_number"
        : kind === "debit"
          ? "debit_note_number"
          : "payment_number";
  const amountKey =
    kind === "receipt" || kind === "payment" ? "amount" : "grand_total";
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title[kind]}</h1>
          <p>Live transactions and posting status from Ledgerly.</p>
        </div>
        <Link className="button" href={`${pathFor[kind]}/new`}>
          + New
        </Link>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>
                  {kind === "credit" || kind === "receipt"
                    ? "Customer"
                    : "Supplier"}
                </th>
                <th>Date</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      className="record-link"
                      href={`${pathFor[kind]}/${row.id}`}
                    >
                      {row[numberKey] || "Draft"}
                    </Link>
                  </td>
                  <td>{party(row)}</td>
                  <td>{row[dateKey]}</td>
                  <td>
                    <Badge>
                      {row.status === "posted" ? "Posted" : "Draft"}
                    </Badge>
                  </td>
                  <td className="amount">{money(row[amountKey])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">No {title[kind].toLowerCase()} yet.</p>
        )}
      </section>
    </>
  );
}

function SettlementForm({
  kind,
  data,
  record,
  reload,
}: {
  kind: Kind;
  data: SettlementData;
  record?: any;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const isSource = kind === "credit" || kind === "debit";
  const isPosted = record?.status === "posted";
  const parties =
    kind === "credit" || kind === "receipt" ? data.customers : data.suppliers;
  const docs =
    kind === "credit" || kind === "receipt" ? data.invoices : data.bills;
  const partyKey =
    kind === "credit" || kind === "receipt" ? "customer_id" : "supplier_id";
  const docKey = kind === "credit" ? "invoice_id" : "bill_id";
  const dateKey =
    kind === "credit"
      ? "credit_note_date"
      : kind === "receipt"
        ? "receipt_date"
        : kind === "debit"
          ? "debit_note_date"
          : "payment_date";
  const [partyId, setPartyId] = useState(
    record?.[partyKey] || parties[0]?.id || "",
  );
  const [sourceId, setSourceId] = useState(record?.[docKey] || "");
  const [documentDate, setDate] = useState(record?.[dateKey] || today);
  const [accountId, setAccount] = useState(
    record?.cash_account_id || data.accounts[0]?.id || "",
  );
  const [amount, setAmount] = useState(String(record?.amount || ""));
  const [reference, setReference] = useState(record?.reference || "");
  const [notes, setNotes] = useState(record?.notes || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const relevantDocs = docs.filter((x: any) => x[partyKey] === partyId);
  const source = relevantDocs.find((x: any) => x.id === sourceId);
  const sourceLines = (
    kind === "credit" ? data.invoiceLines : data.billLines
  ).filter(
    (x: any) => x[kind === "credit" ? "invoice_id" : "bill_id"] === sourceId,
  );
  const existingLines = record
    ? (kind === "credit" ? data.creditLines : data.debitLines).filter(
        (x: any) =>
          x[kind === "credit" ? "credit_note_id" : "debit_note_id"] ===
          record.id,
      )
    : [];
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      existingLines.map((x: any) => [
        x[kind === "credit" ? "source_invoice_line_id" : "source_bill_line_id"],
        String(x.quantity),
      ]),
    ),
  );
  const [returnFlags, setReturnFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      existingLines.map((x: any) => [
        x[kind === "credit" ? "source_invoice_line_id" : "source_bill_line_id"],
        Boolean(x[kind === "credit" ? "return_to_stock" : "return_from_stock"]),
      ]),
    ),
  );
  const openRows = data.openItems.filter(
    (x: any) =>
      x.kind === (kind === "receipt" ? "receivable" : "payable") &&
      x[partyKey] === partyId &&
      n(x.remaining_amount) > 0,
  );
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const allocationTotal = Object.values(allocations).reduce(
    (sum, value) => sum + n(value),
    0,
  );
  const paidAmount = n(amount);
  const exact =
    paidAmount > 0 && Math.abs(allocationTotal - paidAmount) < 0.000001;
  const eligibleQuantity = (line: any) => {
    const postedIds = new Set(
      (kind === "credit" ? data.creditNotes : data.debitNotes)
        .filter((x: any) => x.status === "posted" && x.id !== record?.id)
        .map((x: any) => x.id),
    );
    const used = (kind === "credit" ? data.creditLines : data.debitLines)
      .filter(
        (x: any) =>
          postedIds.has(
            x[kind === "credit" ? "credit_note_id" : "debit_note_id"],
          ) &&
          x[
            kind === "credit" ? "source_invoice_line_id" : "source_bill_line_id"
          ] === line.id,
      )
      .reduce((sum: number, x: any) => sum + n(x.quantity), 0);
    return Math.max(0, n(line.quantity) - used);
  };
  const tax = (line: any, qty: number) =>
    n(line.unit_price) * qty - (n(line.discount) * qty) / n(line.quantity || 1);
  const preview = sourceLines.reduce(
    (sum: number, line: any) => sum + tax(line, n(quantities[line.id])),
    0,
  );
  const vat = sourceLines.reduce(
    (sum: number, line: any) =>
      sum +
      (tax(line, n(quantities[line.id])) *
        n(
          data.taxRates.find((rate: any) => rate.id === line.tax_rate_id)
            ?.rate_percent,
        )) /
        100,
    0,
  );
  const go = () => router.push(pathFor[kind]);
  const run = async (work: Promise<any>, after?: (result: any) => void) => {
    setBusy(true);
    setNotice("");
    const result = await work;
    setBusy(false);
    if (result.error) setNotice(result.error);
    else {
      await reload();
      after?.(result);
    }
  };
  const save = () => {
    if (kind === "credit")
      return run(
        saveCreditNote({
          id: record?.id,
          customerId: partyId,
          invoiceId: sourceId,
          documentDate,
          reference,
          notes,
          lines: sourceLines
            .filter((x: any) => n(quantities[x.id]) > 0)
            .map((x: any) => ({
              sourceLineId: x.id,
              quantity: n(quantities[x.id]),
              physicalReturn: !!returnFlags[x.id],
            })),
        }),
        (r) => router.push(`${pathFor[kind]}/${r.id || record.id}`),
      );
    if (kind === "debit")
      return run(
        saveDebitNote({
          id: record?.id,
          supplierId: partyId,
          billId: sourceId,
          documentDate,
          reference,
          notes,
          lines: sourceLines
            .filter((x: any) => n(quantities[x.id]) > 0)
            .map((x: any) => ({
              sourceLineId: x.id,
              quantity: n(quantities[x.id]),
              physicalReturn: !!returnFlags[x.id],
            })),
        }),
        (r) => router.push(`${pathFor[kind]}/${r.id || record.id}`),
      );
    const input = {
      id: record?.id,
      partyId,
      documentDate,
      accountId,
      amount: paidAmount,
      reference,
      notes,
    };
    return run(
      kind === "receipt" ? saveReceipt(input) : saveSupplierPayment(input),
      (r) => router.push(`${pathFor[kind]}/${r.id || record.id}`),
    );
  };
  const post = () => {
    const allocationPayload = openRows
      .filter((x: any) => n(allocations[x.id]) > 0)
      .map((x: any) => ({ openItemId: x.id, amount: n(allocations[x.id]) }));
    return kind === "credit"
      ? run(postCreditNote(record.id), () => router.refresh())
      : kind === "debit"
        ? run(postDebitNote(record.id), () => router.refresh())
        : run(
            kind === "receipt"
              ? postReceipt(record.id, allocationPayload)
              : postSupplierPayment(record.id, allocationPayload),
            () => router.refresh(),
          );
  };
  const remove = () => {
    const work =
      kind === "credit"
        ? deleteCreditNote(record.id)
        : kind === "receipt"
          ? deleteReceipt(record.id)
          : kind === "debit"
            ? deleteDebitNote(record.id)
            : deleteSupplierPayment(record.id);
    void run(work, go);
  };
  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {record
              ? isPosted
                ? record.credit_note_number ||
                  record.receipt_number ||
                  record.debit_note_number ||
                  record.payment_number ||
                  "Posted settlement"
                : "Edit draft"
              : `New ${title[kind].slice(0, -1)}`}
          </h1>
          <p>
            {isPosted
              ? "Posted transactions are read-only."
              : "Draft changes are validated again when posted."}
          </p>
        </div>
        <div className="header-actions">
          <Link className="button secondary" href={pathFor[kind]}>Back to list</Link>
          {isPosted && <Link className="button" href={`/documents/${kind === "credit" ? "credit-note" : kind === "debit" ? "debit-note" : kind}/${record.id}/print`}>Print / PDF</Link>}
        </div>
      </div>
      <section className="panel form-panel settlement-form">
        {notice && <p className="error">{notice}</p>}
        <div className="form-grid">
          <label>
            {kind === "credit" || kind === "receipt" ? "Customer" : "Supplier"}
            <select
              value={partyId}
              disabled={isPosted || (!!record && isSource)}
              onChange={(e) => {
                setPartyId(e.target.value);
                setSourceId("");
                setReturnFlags({});
              }}
            >
              <option value="">Select…</option>
              {parties.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {isSource ? (
            <label>
              {kind === "credit"
                ? "Source sales invoice"
                : "Source purchase bill"}
              <select
                value={sourceId}
                disabled={isPosted || !!record}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setQuantities({});
                  setReturnFlags({});
                }}
              >
                <option value="">Select…</option>
                {relevantDocs.map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.invoice_number || x.bill_number || "Posted document"} ·{" "}
                    {money(x.grand_total)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Cash / Bank account
              <select
                value={accountId}
                disabled={isPosted}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">Select…</option>
                {data.accounts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Date
            <input
              type="date"
              value={documentDate}
              disabled={isPosted}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {!isSource && (
            <label>
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                disabled={isPosted}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          <label>
            Reference
            <input
              value={reference}
              disabled={isPosted}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>
        <label className="wide-label">
          Notes
          <textarea
            value={notes}
            disabled={isPosted}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {isSource && source && (
          <>
            <div className="line-head">
              <h2>Source lines</h2>
              <span className="notice">
                Physical stock movement is explicit per tracked-product line.
                Financial-only notes leave stock unchanged.
              </span>
            </div>
            <div className="allocation-list">
              {sourceLines.map((line: any) => {
                const product = data.products.find(
                  (x: any) => x.id === line.product_id,
                );
                const location = data.locations.find(
                  (x: any) => x.id === line.inventory_location_id,
                );
                const tracked =
                  product?.kind === "product" && product?.track_inventory;
                return (
                  <div className="allocation-card" key={line.id}>
                    <div>
                      <b>
                        {product
                          ? `${product.sku} · ${product.name}`
                          : line.description}
                      </b>
                      <span>
                        Source quantity {n(line.quantity)} · Eligible{" "}
                        {eligibleQuantity(line)} · {money(line.unit_price)} each
                        {tracked
                          ? ` · ${location?.name || "Source location"}`
                          : " · No stock effect"}
                      </span>
                    </div>
                    <label>
                      Quantity to {kind === "credit" ? "credit" : "debit"}
                      <input
                        type="number"
                        min="0"
                        max={eligibleQuantity(line)}
                        step="0.001"
                        disabled={isPosted}
                        value={quantities[line.id] || ""}
                        onChange={(e) =>
                          setQuantities({
                            ...quantities,
                            [line.id]: e.target.value,
                          })
                        }
                      />
                    </label>
                    {tracked && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          disabled={isPosted}
                          checked={!!returnFlags[line.id]}
                          onChange={(e) =>
                            setReturnFlags({
                              ...returnFlags,
                              [line.id]: e.target.checked,
                            })
                          }
                        />
                        {kind === "credit"
                          ? "Return to stock"
                          : "Return stock to supplier"}
                      </label>
                    )}
                    <strong>{money(tax(line, n(quantities[line.id])))}</strong>
                  </div>
                );
              })}
            </div>
            <div className="totals">
              <span>
                Subtotal <b>{money(preview)}</b>
              </span>
              <span>
                VAT preview <b>{money(vat)}</b>
              </span>
              <strong>
                Total <b>{money(preview + vat)}</b>
              </strong>
            </div>
          </>
        )}
        {!isSource && record && !isPosted && (
          <>
            <div className="line-head">
              <h2>Open {kind === "receipt" ? "invoices" : "bills"}</h2>
              <span className="notice">
                Allocated total must equal{" "}
                {kind === "receipt" ? "receipt" : "payment"} amount.
              </span>
            </div>
            <div className="allocation-list">
              {openRows.map((item: any) => {
                const doc = docs.find(
                  (x: any) => x.id === item.source_document_id,
                );
                const allocated = n(allocations[item.id]);
                return (
                  <div className="allocation-card" key={item.id}>
                    <div>
                      <b>
                        {doc?.invoice_number ||
                          doc?.bill_number ||
                          "Source document"}
                      </b>
                      <span>
                        {doc?.invoice_date || doc?.bill_date} · Original{" "}
                        {money(item.original_amount)} · Open{" "}
                        {money(item.remaining_amount)} ·{" "}
                        <Badge>
                          {status(
                            n(item.remaining_amount),
                            n(item.original_amount),
                          )}
                        </Badge>
                      </span>
                    </div>
                    <label>
                      Allocate now
                      <input
                        type="number"
                        min="0"
                        max={n(item.remaining_amount)}
                        step="0.01"
                        value={allocations[item.id] || ""}
                        onChange={(e) =>
                          setAllocations({
                            ...allocations,
                            [item.id]: e.target.value,
                          })
                        }
                      />
                    </label>
                    <strong>
                      Remaining{" "}
                      {money(Math.max(0, n(item.remaining_amount) - allocated))}
                    </strong>
                  </div>
                );
              })}
            </div>
            <div className="totals">
              <span>
                Allocated total <b>{money(allocationTotal)}</b>
              </span>
              <span>
                Remaining {kind === "receipt" ? "receipt" : "payment"}{" "}
                <b>{money(Math.max(0, paidAmount - allocationTotal))}</b>
              </span>
            </div>
          </>
        )}
        {isPosted && <PostedDetails kind={kind} record={record} />}
        <div className="form-actions">
          {!isPosted && (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void save()}
              >
                Save draft
              </button>
              {record && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={remove}
                >
                  Delete draft
                </button>
              )}
              {record && (
                <button
                  className="button"
                  disabled={busy || (!isSource && !exact)}
                  onClick={() => void post()}
                >
                  {busy ? "Working…" : "Post"}
                </button>
              )}
            </>
          )}{" "}
        </div>
      </section>
    </>
  );
}

function PostedDetails({ kind, record }: { kind: Kind; record: any }) {
  const amount =
    kind === "receipt" || kind === "payment"
      ? record.amount
      : record.grand_total;
  return (
    <>
      <div className="totals">
        <span>
          Subtotal <b>{money(record.subtotal)}</b>
        </span>
        <span>
          VAT <b>{money(record.tax_total)}</b>
        </span>
        <strong>
          Total <b>{money(amount)}</b>
        </strong>
      </div>
      {record.posted_journal_id && (
        <p className="posted-journal">
          Posted Journal:{" "}
          <Link
            className="record-link"
            href={`/accounting/journals/${record.posted_journal_id}`}
          >
            View JV
          </Link>
        </p>
      )}
      <p className="notice">
        This posted settlement is immutable. Settlement status is derived from
        its open item, not an editable field.
      </p>
    </>
  );
}
