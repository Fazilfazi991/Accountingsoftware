"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getBusinessDocumentData,
  postBusinessDocument,
  saveBusinessDocument,
  type BusinessDocumentData,
} from "@/app/actions/business-documents";
type Kind = "invoice" | "bill";
type Line = {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRateId: string;
  accountId: string;
  locationId: string;
};
const today = new Date().toISOString().slice(0, 10),
  money = (x: unknown) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
    }).format(Number(x || 0));
export function BusinessDocumentWorkflow({
  kind,
  id,
}: {
  kind: Kind;
  id?: string;
}) {
  const router = useRouter(),
    [data, setData] = useState<BusinessDocumentData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [partyId, setParty] = useState(""),
    [documentDate, setDate] = useState(today),
    [dueDate, setDue] = useState(today),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [lines, setLines] = useState<Line[]>([]);
  useEffect(() => {
    void getBusinessDocumentData().then((result) => {
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setData(result);
      const doc = (kind === "invoice" ? result.invoices : result.bills).find(
          (x: any) => x.id === id,
        ),
        sourceLines = (
          kind === "invoice" ? result.invoiceLines : result.billLines
        ).filter(
          (x: any) => x[kind === "invoice" ? "invoice_id" : "bill_id"] === id,
        );
      if (doc) {
        setParty(doc[kind === "invoice" ? "customer_id" : "supplier_id"]);
        setDate(doc[kind === "invoice" ? "invoice_date" : "bill_date"]);
        setDue(doc.due_date);
        setReference(doc.reference || "");
        setNotes(doc.notes || "");
        setLines(
          sourceLines.map((x: any) => ({
            productId: x.product_id,
            description: x.description,
            quantity: Number(x.quantity),
            unitPrice: Number(x.unit_price),
            discount: Number(x.discount),
            taxRateId: x.tax_rate_id || "",
            accountId:
              x[
                kind === "invoice" ? "revenue_account_id" : "expense_account_id"
              ] || defaultAccount(result, kind),
            locationId: x.inventory_location_id || "",
          })),
        );
      } else {
        setParty(
          (kind === "invoice" ? result.customers : result.suppliers)[0]?.id ||
            "",
        );
        setLines([newLine(result, kind)]);
      }
    });
  }, [id, kind]);
  if (!data)
    return (
      <>
        <div className="page-header">
          <div>
            <h1>
              {id
                ? "Edit draft"
                : kind === "invoice"
                  ? "New sales invoice"
                  : "New purchase bill"}
            </h1>
            <p>Loading real products and stock availability…</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </>
    );
  const parties = kind === "invoice" ? data.customers : data.suppliers,
    accounts = data.accounts.filter((x) =>
      kind === "invoice"
        ? x.account_type === "income"
        : ["expense", "asset"].includes(x.account_type),
    );
  const change = (index: number, next: Partial<Line>) =>
    setLines((current) =>
      current.map((x, i) => (i === index ? { ...x, ...next } : x)),
    );
  const chooseProduct = (index: number, productId: string) => {
    const p = data.products.find((x) => x.id === productId),
      tracked = p?.kind === "product" && p.track_inventory,
      location = tracked
        ? data.locations.find((x) => x.is_default)?.id ||
          data.locations[0]?.id ||
          ""
        : "";
    change(index, {
      productId,
      description: p?.name || "",
      unitPrice:
        Number(kind === "invoice" ? p?.sales_price : p?.purchase_price) || 0,
      taxRateId: p?.tax_rate_id || "",
      locationId: location,
    });
  };
  const available = (line: Line) =>
    data.summary
      .filter(
        (x) =>
          x.product_id === line.productId && x.location_id === line.locationId,
      )
      .reduce((s, x) => s + Number(x.quantity_on_hand), 0);
  const tracked = (line: Line) => {
    const p = data.products.find((x) => x.id === line.productId);
    return p?.kind === "product" && p.track_inventory;
  };
  const oversale =
    kind === "invoice" &&
    lines.some((x) => tracked(x) && x.quantity > available(x));
  const subtotal = lines.reduce(
    (s, x) => s + Math.max(0, x.quantity * x.unitPrice - x.discount),
    0,
  );
  const vat = lines.reduce((s, x) => {
    const rate = data.taxRates.find((r) => r.id === x.taxRateId);
    return (
      s +
      (Math.max(0, x.quantity * x.unitPrice - x.discount) *
        Number(rate?.rate_percent || 0)) /
        100
    );
  }, 0);
  async function save(post: boolean) {
    setBusy(true);
    setError("");
    const result = await saveBusinessDocument({
      id,
      kind,
      partyId,
      documentDate,
      dueDate,
      reference,
      notes,
      lines: lines.map((x) => ({
        ...x,
        taxRateId: x.taxRateId || undefined,
        locationId: x.locationId || undefined,
      })),
    });
    if ("error" in result) {
      setError(result.error || "The draft could not be saved.");
      setBusy(false);
      return;
    }
    if (post) {
      const posted = await postBusinessDocument(kind, result.id);
      if ("error" in posted) {
        setError(`${posted.error} Draft ${result.id} was retained.`);
        setBusy(false);
        return;
      }
    }
    router.push(
      `/${kind === "invoice" ? "sales/invoices" : "purchases/bills"}/${result.id}`,
    );
    router.refresh();
  }
  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {id
              ? "Edit draft"
              : kind === "invoice"
                ? "New sales invoice"
                : "New purchase bill"}
          </h1>
          <p>
            Financial posting and quantity movements commit atomically. No COGS
            or valuation is posted.
          </p>
        </div>
        <Link
          className="button secondary"
          href={kind === "invoice" ? "/sales/invoices" : "/purchases/bills"}
        >
          Back to list
        </Link>
      </div>
      <section className="panel form-panel">
        <div className="form-grid">
          <label>
            {kind === "invoice" ? "Customer" : "Supplier"}
            <select value={partyId} onChange={(e) => setParty(e.target.value)}>
              {parties.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <input value={data.branch.name} readOnly />
          </label>
          <label>
            {kind === "invoice" ? "Invoice date" : "Bill date"}
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label>
            Reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>
        <div className="line-head">
          <h2>Items and services</h2>
          <button
            className="text-button"
            onClick={() =>
              setLines((current) => [...current, newLine(data, kind)])
            }
          >
            + Add line
          </button>
        </div>
        <div className="line-editor inventory-document-lines">
          {lines.map((line, index) => {
            const p = data.products.find((x) => x.id === line.productId),
              isTracked = tracked(line),
              stock = available(line),
              warning =
                kind === "invoice" && isTracked && line.quantity > stock;
            return (
              <div className="line-row inventory-document-line" key={index}>
                <label>
                  Product / service
                  <select
                    value={line.productId}
                    onChange={(e) => chooseProduct(index, e.target.value)}
                  >
                    {data.products.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} {x.sku ? `(${x.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={line.quantity}
                    onChange={(e) =>
                      change(index, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Unit
                  <input value={p?.inventory_units?.code || "—"} readOnly />
                </label>
                <label>
                  Unit price
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={line.unitPrice}
                    onChange={(e) =>
                      change(index, { unitPrice: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Discount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.discount}
                    onChange={(e) =>
                      change(index, { discount: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Tax
                  <select
                    value={line.taxRateId}
                    onChange={(e) =>
                      change(index, { taxRateId: e.target.value })
                    }
                  >
                    <option value="">No tax</option>
                    {data.taxRates
                      .filter((x) =>
                        kind === "invoice"
                          ? x.sales_enabled
                          : x.purchase_enabled,
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {x.rate_percent}%
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Account
                  <select
                    value={line.accountId}
                    onChange={(e) =>
                      change(index, { accountId: e.target.value })
                    }
                  >
                    {accounts.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Stock location
                  <select
                    disabled={!isTracked}
                    value={line.locationId}
                    onChange={(e) =>
                      change(index, { locationId: e.target.value })
                    }
                  >
                    {!isTracked && <option value="">Not applicable</option>}
                    {data.locations.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === "invoice" && isTracked ? (
                  <span className={warning ? "error" : "notice"}>
                    Available {stock} {p?.inventory_units?.code}
                    {warning ? " · requested quantity is too high" : ""}
                  </span>
                ) : (
                  <span className="notice">
                    {isTracked
                      ? "Stock will increase on posting"
                      : "No stock movement"}
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <label className="wide-label">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        {oversale && (
          <p className="error">
            One or more lines exceed current stock. The server will reject an
            oversale atomically.
          </p>
        )}
        <div className="totals">
          <span>
            Subtotal <b>{money(subtotal)}</b>
          </span>
          <span>
            VAT <b>{money(vat)}</b>
          </span>
          <strong>
            Total <b>{money(subtotal + vat)}</b>
          </strong>
        </div>
        <div className="form-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save draft
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void save(true)}
          >
            {busy
              ? "Working…"
              : kind === "invoice"
                ? "Post invoice"
                : "Post bill"}
          </button>
        </div>
      </section>
    </>
  );
}
function defaultAccount(data: BusinessDocumentData, kind: Kind) {
  return (
    data.accounts.find(
      (x) =>
        x.system_key ===
        (kind === "invoice" ? "sales_revenue" : "rent_expense"),
    )?.id ||
    data.accounts.find((x) =>
      kind === "invoice"
        ? x.account_type === "income"
        : ["expense", "asset"].includes(x.account_type),
    )?.id ||
    ""
  );
}
function newLine(data: BusinessDocumentData, kind: Kind): Line {
  const p = data.products[0],
    tracked = p?.kind === "product" && p.track_inventory;
  return {
    productId: p?.id || "",
    description: p?.name || "",
    quantity: 1,
    unitPrice:
      Number(kind === "invoice" ? p?.sales_price : p?.purchase_price) || 0,
    discount: 0,
    taxRateId: p?.tax_rate_id || "",
    accountId: defaultAccount(data, kind),
    locationId: tracked
      ? data.locations.find((x) => x.is_default)?.id ||
        data.locations[0]?.id ||
        ""
      : "",
  };
}
