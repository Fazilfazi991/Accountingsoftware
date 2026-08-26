"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPrintDocument } from "@/app/actions/documents";
const money = (v: unknown) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    Number(v || 0),
  );
export function DocumentPrint({ kind, id }: { kind: string; id: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void getPrintDocument(kind, id).then((r) =>
      "error" in r ? setError(r.error || "Document unavailable.") : setData(r),
    );
  }, [kind, id]);
  if (error)
    return (
      <section className="panel">
        <h1>Document unavailable</h1>
        <p className="error">{error}</p>
      </section>
    );
  if (!data)
    return <section className="panel">Preparing authorized document…</section>;
  const {
    document: d,
    organization: o,
    branch,
    party,
    partyLabel,
    lines,
    source,
    allocations,
  } = data;
  return (
    <div className="print-document">
      <div className="print-actions">
        <button className="button" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <button className="button secondary" onClick={() => history.back()}>
          Back
        </button>
      </div>
      <header>
        <div>
          <div className="print-brand">Ledgerly</div>
          <h1>{o.legalName || o.name}</h1>
          <p>{o.address || "United Arab Emirates"}</p>
          <p>{[o.email, o.phone].filter(Boolean).join(" · ")}</p>
          {o.trn && <p>TRN: {o.trn}</p>}
        </div>
        <div className="print-title">
          <h2>{d.title}</h2>
          <strong>{d.number}</strong>
          <span className="badge b-posted">{d.status}</span>
        </div>
      </header>
      <section className="print-meta">
        <div>
          <b>{partyLabel}</b>
          <strong>{party?.name || d.payee || "—"}</strong>
          {party?.trn && <span>TRN: {party.trn}</span>}
          <span>{party?.billing_address || ""}</span>
        </div>
        <div>
          <b>Document date</b>
          <strong>{d.date}</strong>
          {branch && (
            <span>
              Branch: {branch.name}
              {branch.code ? ` (${branch.code})` : ""}
            </span>
          )}
          {d.reference && <span>Reference: {d.reference}</span>}
          {source && <span>Source: {source.number}</span>}
        </div>
      </section>
      {lines.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Discount</th>
                <th>VAT</th>
                <th>Line amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l: any) => {
                const net =
                    Number(l.quantity) * Number(l.unit_price) -
                    Number(l.discount || 0),
                  rate = Number(l.tax_rates?.rate_percent || 0);
                return (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td>{Number(l.quantity)}</td>
                    <td className="amount">{money(l.unit_price)}</td>
                    <td className="amount">{money(l.discount)}</td>
                    <td className="amount">{rate}%</td>
                    <td className="amount">
                      {money(net + (net * rate) / 100)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {allocations.length > 0 && (
        <section className="print-allocations">
          <h3>Allocations</h3>
          {allocations.map((a: any, i: number) => (
            <p key={i}>
              <span>
                Source document {a.sourceNumber || a.open_items?.source_document_id}
              </span>
              <strong>{money(a.amount)}</strong>
            </p>
          ))}
        </section>
      )}
      <section className="print-totals">
        {d.subtotal > 0 && (
          <p>
            <span>Subtotal</span>
            <strong>{money(d.subtotal)}</strong>
          </p>
        )}
        {d.tax > 0 && (
          <p>
            <span>VAT</span>
            <strong>{money(d.tax)}</strong>
          </p>
        )}
        <p className="grand">
          <span>Total</span>
          <strong>{money(d.total)}</strong>
        </p>
      </section>
      {d.notes && (
        <section className="print-notes">
          <b>Notes</b>
          <p>{d.notes}</p>
        </section>
      )}
      <footer>
        <span>Generated from canonical {d.status} Ledgerly data.</span>
        {d.postedJournalId && (
          <Link href={`/accounting/journals/${d.postedJournalId}`}>
            Journal reference
          </Link>
        )}
      </footer>
    </div>
  );
}
