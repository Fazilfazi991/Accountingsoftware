"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getBusinessDocumentData,
  postBusinessDocument,
  saveBusinessDocument,
  type BusinessDocumentData,
} from "@/app/actions/business-documents";
import { getConversionSources, saveConvertedInvoice } from "@/app/actions/sales-workflow";
import { dubaiCalendarDate } from "@/lib/dubai-date";
import { calculateBusinessDocumentTotals } from "@/lib/business-document-totals";
import { SearchableSelector } from "@/components/searchable-selector";
import { searchMasterRecords } from "@/app/actions/master-search";
import { normalizeToPrimary, rateForUnit, validProductUnits } from "@/lib/uom";
import {
  newLine,
  productSelectionPatch,
  savedLineAccount,
  type BusinessDocumentKind as Kind,
  type BusinessDocumentLine as Line,
} from "@/lib/business-document-lines";
const today = dubaiCalendarDate(),
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
    searchParams = useSearchParams(),
    conversionSourceType = searchParams.get("sourceType") as "quotation" | "delivery_note" | null,
    conversionSourceIds = searchParams.get("sourceIds") || "",
    [data, setData] = useState<BusinessDocumentData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [partyId, setParty] = useState(""),
    [documentDate, setDate] = useState(today),
    [dueDate, setDue] = useState(today),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [invoiceDiscountType, setInvoiceDiscountType] = useState<"fixed" | "percentage">("fixed"),
    [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0),
    [vatTreatment, setVatTreatment] = useState<"affects_vat" | "post_tax">("affects_vat"),
    [roundOff, setRoundOff] = useState(0),
    [lines, setLines] = useState<Line[]>([]),
    dirty = useRef({ party:false, reference:false, lines:false });
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
        if (kind === "invoice") { setInvoiceDiscountType(doc.invoice_discount_type || "fixed"); setInvoiceDiscountValue(Number(doc.invoice_discount_value || 0)); setVatTreatment(doc.vat_treatment || "affects_vat"); setRoundOff(Number(doc.round_off || 0)); }
        setLines(
          sourceLines.map((x: any) => ({
            productId: x.product_id,
            description: x.description,
            quantity: Number(x.transaction_quantity ?? x.quantity),
            unitId: x.transaction_unit_id || result.products.find((p:any) => p.id === x.product_id)?.unit_id || "",
            unitPrice: Number(x.transaction_unit_price ?? x.unit_price),
            discount: Number(x.discount),
            discountType: x.discount_type || "fixed",
            discountValue: Number(x.discount_value ?? x.discount),
            taxRateId: x.tax_rate_id || "",
            accountId: savedLineAccount(
              x[kind === "invoice" ? "revenue_account_id" : "expense_account_id"],
              result,
              kind,
            ),
            locationId: x.inventory_location_id || "",
          })),
        );
      } else {
        setParty(
          (kind === "invoice" ? result.customers : result.suppliers)[0]?.id ||
            "",
        );
        setLines([newLine(result, kind)]);
        const sourceType = conversionSourceType,
          sourceIds = conversionSourceIds.split(",").filter(Boolean);
        if (kind === "invoice" && sourceType && sourceIds.length) {
          void getConversionSources(sourceType, sourceIds).then((sources) => {
            if ("error" in sources) { setError(sources.error || "Unable to load conversion sources."); return; }
            if (!dirty.current.party) setParty(sources.customerId);
            if (!dirty.current.reference) setReference(`Created from ${sources.documents.map((x: any) => x.quotation_number || x.delivery_note_number).join(", ")}`);
            if (!dirty.current.lines) setLines(sources.lines.map((x: any) => ({
              productId:x.product_id, description:x.description, quantity:x.transactionRemaining,
              unitId:x.transaction_unit_id || result.products.find((p:any) => p.id === x.product_id)?.unit_id || "",
              unitPrice:Number(x.transaction_unit_price ?? x.unit_price), discount:Number(x.discount)*Number(x.remaining)/Number(x.quantity), taxRateId:x.tax_rate_id||"",
              accountId:savedLineAccount(x.revenue_account_id,result,"invoice"),
              locationId: result.locations.find((l:any)=>l.is_default)?.id || result.locations[0]?.id || "",
              sourceType:x.sourceType, sourceDocumentId:x.sourceDocumentId, sourceLineId:x.id, remaining:x.transactionRemaining,
              sourceDiscountPerUnit:Number(x.discount)/Number(x.transaction_quantity ?? x.quantity),
            })));
          });
        }
      }
    });
  }, [id, kind, conversionSourceType, conversionSourceIds]);
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
  const change = (index: number, next: Partial<Line>) => {
    dirty.current.lines = true;
    setLines((current) =>
      current.map((x, i) => (i === index ? { ...x, ...next } : x)),
    );
  };
  const chooseProduct = (index: number, productId: string) => {
    change(index, productSelectionPatch(data, kind, productId));
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
  const normalized = (line: Line) => {
    const product = data.products.find((x) => x.id === line.productId);
    if (!product || !line.unitId) return line.quantity;
    try { return Number(normalizeToPrimary(line.quantity, line.unitId, product)); }
    catch { return Number.POSITIVE_INFINITY; }
  };
  const oversale =
    kind === "invoice" &&
    lines.some((x) => tracked(x) && normalized(x) > available(x));
  const totals = calculateBusinessDocumentTotals(lines, data.taxRates, kind === "invoice" ? { discountType: invoiceDiscountType, discountValue: invoiceDiscountValue, vatTreatment, roundOff } : {});
  async function save(post: boolean) {
    setBusy(true);
    setError("");
    const allocations = lines.filter((x) => x.sourceLineId).map((x) => ({
      sourceType:x.sourceType!, sourceDocumentId:x.sourceDocumentId!, sourceLineId:x.sourceLineId!, quantity:normalized(x),
    }));
    const payload = {
      id,
      kind,
      partyId,
      documentDate,
      dueDate,
      reference,
      notes,
      invoiceDiscountType,
      invoiceDiscountValue: kind === "invoice" ? invoiceDiscountValue : 0,
      vatTreatment,
      roundOff: kind === "invoice" ? roundOff : 0,
      lines: lines.map((x) => ({
        ...x,
        discountType: x.discountType || "fixed",
        discountValue: x.discountValue ?? x.discount,
        taxRateId: x.taxRateId || undefined,
        locationId: x.locationId || undefined,
      })),
    };
    const result = kind === "invoice" && !id && allocations.length
      ? await saveConvertedInvoice({ ...payload, customerId:partyId, allocations })
      : await saveBusinessDocument(payload);
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
          <SearchableSelector label={kind === "invoice" ? "Customer" : "Supplier"} value={partyId}
            options={parties.map((x) => ({ id:x.id, label:x.name, description:[x.phone,x.email].filter(Boolean).join(" · ") }))}
            search={(query)=>searchMasterRecords(kind==="invoice"?"customer":"supplier",query)} onChange={(value) => { dirty.current.party = true; setParty(value); }} required />
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
              onChange={(e) => { dirty.current.reference = true; setReference(e.target.value); }}
            />
          </label>
        </div>
        <div className="line-head">
          <h2>Items and services</h2>
          <button
            className="text-button"
            onClick={() => { dirty.current.lines = true; setLines((current) => [...current, newLine(data, kind)]); }}
          >
            + Add line
          </button>
        </div>
        <div className="line-editor inventory-document-lines">
          {lines.map((line, index) => {
            const p = data.products.find((x) => x.id === line.productId),
              units = p ? validProductUnits(p) : [],
              isTracked = tracked(line),
              stock = available(line),
              warning =
                kind === "invoice" && isTracked && normalized(line) > stock;
            return (
              <div className="line-row inventory-document-line" key={index}>
                <SearchableSelector label="Product / service" value={line.productId}
                  options={data.products.map((x) => ({ id:x.id, label:x.name, description:[x.sku, x.inventory_units?.code].filter(Boolean).join(" · "), search:x.sku }))}
                  search={(query)=>searchMasterRecords("product",query)} onChange={(value) => chooseProduct(index, value)} required />
                <label>
                  Quantity
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={line.quantity}
                    max={line.remaining}
                    onChange={(e) =>
                      change(index, { quantity: Number(e.target.value), ...(line.sourceDiscountPerUnit == null ? {} : { discount:Number(e.target.value)*line.sourceDiscountPerUnit }) })
                    }
                  />
                </label>
                {line.sourceLineId && <span className="notice">Source line · maximum remaining {line.remaining}</span>}
                <label>
                  Unit
                  <select
                    value={line.unitId}
                    disabled={units.length <= 1 || Boolean(line.sourceLineId)}
                    onChange={(e) => {
                      const unitId = e.target.value;
                      const primaryRate = kind === "invoice" ? p?.sales_price : p?.purchase_price;
                      change(index, { unitId, unitPrice: Number(rateForUnit(primaryRate || 0, unitId, p)) });
                    }}
                  >
                    {!units.length && <option value="">No unit</option>}
                    {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code}</option>)}
                  </select>
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
                <label className="discount-control">Discount<div className="discount-input"><select aria-label="Discount type" value={line.discountType || "fixed"} onChange={(e) => change(index, { discountType:e.target.value as "fixed"|"percentage", discountValue:0, discount:0 })}><option value="fixed">AED</option><option value="percentage">%</option></select><input
                    type="number"
                    min="0"
                    max={line.discountType === "percentage" ? 100 : undefined}
                    step="0.01"
                    value={line.discountValue ?? line.discount}
                    onChange={(e) => { const value=Number(e.target.value); change(index, { discountValue:value, discount:line.discountType === "percentage" ? line.quantity*line.unitPrice*value/100 : value }); }}
                  /></div>
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
                  Account *
                  <select
                    aria-required="true"
                    value={line.accountId}
                    onChange={(e) =>
                      change(index, { accountId: e.target.value })
                    }
                  >
                    <option value="">Select account</option>
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
                  onClick={() => { dirty.current.lines = true; setLines((current) => current.filter((_, i) => i !== index)); }}
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
        {kind === "invoice" && <div className="invoice-adjustments"><h2>Invoice adjustments</h2><div className="form-grid">
          <label>Invoice discount<div className="discount-input"><select value={invoiceDiscountType} onChange={(e)=>setInvoiceDiscountType(e.target.value as "fixed"|"percentage")}><option value="fixed">AED</option><option value="percentage">%</option></select><input type="number" min="0" max={invoiceDiscountType==="percentage"?100:undefined} step="0.01" value={invoiceDiscountValue} onChange={(e)=>setInvoiceDiscountValue(Number(e.target.value))}/></div></label>
          <label>VAT treatment<select value={vatTreatment} onChange={(e)=>setVatTreatment(e.target.value as "affects_vat"|"post_tax")}><option value="affects_vat">Discount reduces taxable amount</option><option value="post_tax">Apply after VAT</option></select></label>
          <label>Round off<input type="number" min="-10" max="10" step="0.01" value={roundOff} onChange={(e)=>setRoundOff(Number(e.target.value))}/><small>Small adjustment only (maximum ± AED 10).</small></label>
        </div></div>}
        {error && <p className="error">{error}</p>}
        {oversale && (
          <p className="error">
            One or more lines exceed current stock. The server will reject an
            oversale atomically.
          </p>
        )}
        <div className="totals">
          <span>
            Subtotal <b>{money(totals.gross)}</b>
          </span>
          {totals.lineDiscount > 0 && <span>Line discounts <b>− {money(totals.lineDiscount)}</b></span>}
          {totals.invoiceDiscount > 0 && <span>Invoice discount <b>− {money(totals.invoiceDiscount)}</b></span>}
          <span>Taxable amount <b>{money(totals.taxable)}</b></span>
          <span>
            VAT <b>{money(totals.vat)}</b>
          </span>
          {totals.postTaxDiscount > 0 && <span>Post-tax discount <b>− {money(totals.postTaxDiscount)}</b></span>}
          {totals.roundOff !== 0 && <span>Round off <b>{totals.roundOff > 0 ? "+ " : "− "}{money(Math.abs(totals.roundOff))}</b></span>}
          <strong>
            Grand total <b>{money(totals.total)}</b>
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
