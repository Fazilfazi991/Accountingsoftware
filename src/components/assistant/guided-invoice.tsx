"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { getAssistantInvoiceData, saveAssistantInvoiceDraft, type AssistantInvoiceData } from "@/app/actions/assistant-invoice";
import { calculateBusinessDocumentTotals } from "@/lib/business-document-totals";
import { documentSchema, documentValidationMessage } from "@/lib/business-document-validation";
import { newLine, productSelectionPatch, type BusinessDocumentLine } from "@/lib/business-document-lines";
import { assistantActionCommandSchema, type ActionId } from "@/lib/assistant/action-registry";
import { dubaiCalendarDate } from "@/lib/dubai-date";
import { emptyInvoiceState, guidedInvoiceReducer } from "@/lib/assistant/invoice-flow";
import { acquireAssistantRequestKey, clearAssistantRequestKey, rotateAssistantRequestKey } from "@/lib/assistant/client-request-key";
import { CustomerSelector } from "./customer-selector";
import { ActionSwitcher } from "./action-switcher";
import styles from "./guided-invoice.module.css";

const money = (value: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(value);
const stages = ["Customer", "Items", "Details", "Preview"];

function blankLine(data: AssistantInvoiceData): BusinessDocumentLine {
  const line = newLine(data, "invoice");
  return { ...line, productId: "", description: "", unitPrice: 0, taxRateId: "", locationId: "" };
}

export function GuidedInvoice({ onClose, onSwitch, allowed, initialCustomerId }: {
  onClose: () => void; onSwitch: (target: ActionId, discardRequired: boolean) => void;
  allowed: Record<string, boolean>; initialCustomerId?: string;
}) {
  const [state, dispatch] = useReducer(guidedInvoiceReducer, emptyInvoiceState);
  const [data, setData] = useState<AssistantInvoiceData | null>(null);
  const [loadError, setLoadError] = useState("");
  const initiated = useRef(false), saving = useRef(false);
  useEffect(() => {
    if (initiated.current) return;
    initiated.current = true;
    void getAssistantInvoiceData().then((result) => {
      if ("error" in result) { setLoadError(result.error); return; }
      setData(result); dispatch({ type: "begin", today: dubaiCalendarDate(),
        requestId: acquireAssistantRequestKey("create_invoice_draft", result.branch.id), firstLine: blankLine(result),
        initialCustomerId: result.customers.some((customer) => customer.id === initialCustomerId) ? initialCustomerId : undefined });
    }).catch(() => setLoadError("Invoice choices could not be loaded. Return to Assistant and try again."));
  }, [initialCustomerId]);

  const customer = data?.customers.find((item) => item.id === state.customerId);
  const totals = calculateBusinessDocumentTotals(state.lines, data?.taxRates || []);
  const incomeAccounts = data?.accounts.filter((item) => item.account_type === "income") || [];
  const lineError = () => {
    const checked = documentSchema.shape.lines.safeParse(state.lines.map((line) => ({
      productId: line.productId, description: line.description, quantity: line.quantity,
      unitPrice: line.unitPrice, discount: line.discount, accountId: line.accountId,
      taxRateId: line.taxRateId || undefined, locationId: line.locationId || undefined,
    })));
    return checked.success ? "" : documentValidationMessage("invoice", checked.error.issues);
  };
  const command = () => ({ action: "create_invoice_draft" as const, args: {
    customerId: state.customerId, items: state.lines.map((line) => ({
      productId: line.productId, description: line.description, quantity: line.quantity,
      unitPrice: line.unitPrice, discount: line.discount, accountId: line.accountId,
      taxRateId: line.taxRateId || undefined, locationId: line.locationId || undefined,
    })), documentDate: state.documentDate, dueDate: state.dueDate,
    reference: state.reference, notes: state.notes,
  } });
  function next() {
    if (state.stage === "customer" && !customer) {
      dispatch({ type: "issue", error: "Choose an active customer before continuing." }); return;
    }
    if (state.stage === "items") {
      const issue = lineError();
      if (issue) { dispatch({ type: "issue", error: issue }); return; }
    }
    if (state.stage === "details") {
      const checked = assistantActionCommandSchema.safeParse(command());
      if (!checked.success) { dispatch({ type: "issue", error: documentValidationMessage("invoice", checked.error.issues) }); return; }
      if (state.dueDate < state.documentDate) {
        dispatch({ type: "issue", error: "Due date must not be before invoice date." }); return;
      }
    }
    dispatch({ type: "next", valid: true });
  }
  function changeLine(index: number, patch: Partial<BusinessDocumentLine>) {
    dispatch({ type: "lines", lines: state.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });
  }
  async function confirm() {
    if (saving.current || !["preview", "uncertain"].includes(state.stage) || !data) return;
    const previewBranchId = data.branch.id;
    const checked = assistantActionCommandSchema.safeParse(command());
    if (!checked.success) { dispatch({ type: "issue", error: documentValidationMessage("invoice", checked.error.issues) }); return; }
    saving.current = true;
    dispatch({ type: "confirm" });
    try {
      const result = await saveAssistantInvoiceDraft(checked.data, previewBranchId, state.requestId);
      if ("error" in result) {
        saving.current = false;
        if (result.safeToRetry) dispatch({ type: "failed", error: result.error });
        else dispatch({ type: "uncertain", error: result.error });
        return;
      }
      dispatch({ type: "saved", id: result.id, number: result.label });
    } catch {
      saving.current = false;
      dispatch({ type: "uncertain", error: "The save response was lost. Retry with this same request ID; it cannot create a second draft." });
    }
  }
  function cancel() { if (["saving", "checking"].includes(state.stage)) return;
    if (data && state.stage !== "uncertain") clearAssistantRequestKey("create_invoice_draft", data.branch.id);
    dispatch({ type: "cancel" }); onClose(); }
  function another() { saving.current = false; dispatch({ type: "begin", today: dubaiCalendarDate(),
    requestId: data ? rotateAssistantRequestKey("create_invoice_draft", data.branch.id) : crypto.randomUUID(),
    firstLine: data ? blankLine(data) : undefined }); }

  if (loadError) return <section className={styles.flow}><h2>Create Invoice</h2><p role="alert" className={styles.error}>{loadError}</p>
    <button type="button" className={styles.secondary} onClick={cancel}>Back to Assistant</button></section>;
  if (!data || state.stage === "idle") return <section className={styles.flow} role="status"><h2>Create Invoice</h2>
    <p>Loading customers, products, tax rates and stock for this branch…</p></section>;
  return <section className={styles.flow} aria-label="Guided invoice creation">
    <div className={styles.top}><div><h2>Create Invoice</h2><p>Prepare a sales invoice draft with Ledgerly’s existing workflow.</p></div>
      {!["saving", "checking", "uncertain"].includes(state.stage) && <button type="button" className={styles.textButton} onClick={cancel}>{state.stage === "success" ? "Back to Assistant" : "Cancel"}</button>}</div>
    {!["success", "uncertain", "checking"].includes(state.stage) && <ol className={styles.progress} aria-label="Invoice steps">
      {stages.map((label, index) => <li key={label} className={label.toLowerCase() === state.stage ? styles.current :
        ["customer", "items", "details", "preview", "saving"].indexOf(state.stage) > index ? styles.complete : ""}>
        <span>{index + 1}</span>{label}</li>)}</ol>}
    <div className={styles.branch}>Current branch: <strong>{data.branch.name}</strong> · Save as draft only</div>

    {state.stage === "customer" && <div className={styles.panel}>
      <h3>Who is this invoice for?</h3><p>Choose an active customer from your company.</p>
      <CustomerSelector customers={data.customers} selectedId={state.customerId}
        onChoose={(id) => dispatch({ type: "customer", id })}
        onAddCustomer={() => onSwitch("create_customer", true)} />
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={next}>Continue to items</button></div>
    </div>}

    {state.stage === "items" && <div className={styles.panel}>
      <h3>Add the items or services</h3><p>Choose each product or service, then review quantity, rate, tax and sales account.</p>
      {state.lines.map((line, index) => {
        const product = data.products.find((item) => item.id === line.productId);
        const tracked = product?.kind === "product" && product.track_inventory;
        const stock = data.summary.filter((row) => row.product_id === line.productId && row.location_id === line.locationId)
          .reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
        return <div className={styles.line} key={index}>
          <div className={styles.lineTop}><strong>Item {index + 1}</strong>{state.lines.length > 1 && <button type="button" className={styles.textButton}
            onClick={() => dispatch({ type: "lines", lines: state.lines.filter((_, i) => i !== index) })}>Remove</button>}</div>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.wide}`}>Product / service<select value={line.productId}
              onChange={(event) => changeLine(index, productSelectionPatch(data, "invoice", event.target.value))}>
              <option value="">Select product or service</option>{data.products.map((item) => <option key={item.id} value={item.id}>
                {item.name}{item.sku ? ` (${item.sku})` : ""}</option>)}</select></label>
            <label className={`${styles.field} ${styles.wide}`}>Description<input value={line.description}
              onChange={(event) => changeLine(index, { description: event.target.value })} maxLength={300} /></label>
            <label className={styles.field}>Quantity<input type="number" inputMode="decimal" min="0.0001" step="0.0001"
              value={line.quantity} onChange={(event) => changeLine(index, { quantity: Number(event.target.value) })} /></label>
            <label className={styles.field}>Unit<input value={product?.inventory_units?.code || "—"} readOnly /></label>
            <label className={styles.field}>Rate (AED)<input type="number" inputMode="decimal" min="0" step="0.0001"
              value={line.unitPrice} onChange={(event) => changeLine(index, { unitPrice: Number(event.target.value) })} /></label>
            <label className={styles.field}>Discount (AED)<input type="number" inputMode="decimal" min="0" step="0.01"
              value={line.discount} onChange={(event) => changeLine(index, { discount: Number(event.target.value) })} /></label>
            <label className={styles.field}>Sales tax<select value={line.taxRateId} onChange={(event) => changeLine(index, { taxRateId: event.target.value })}>
              <option value="">No tax</option>{data.taxRates.filter((rate) => rate.sales_enabled).map((rate) => <option key={rate.id} value={rate.id}>
                {rate.name} · {rate.rate_percent}%</option>)}</select></label>
            <label className={styles.field}>Sales account *<select value={line.accountId} onChange={(event) => changeLine(index, { accountId: event.target.value })}>
              <option value="">Select account</option>{incomeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            {tracked && <label className={styles.field}>Stock location<select value={line.locationId}
              onChange={(event) => changeLine(index, { locationId: event.target.value })}>
              <option value="">Select location</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
          </div>
          {tracked && <p className={line.quantity > stock ? styles.error : styles.hint}>Available in this branch: {stock} {product?.inventory_units?.code || "units"}</p>}
        </div>;
      })}
      <button type="button" className={styles.add} onClick={() => dispatch({ type: "lines", lines: [...state.lines, blankLine(data)] })}>+ Add another item</button>
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => dispatch({ type: "edit", stage: "customer" })}>Back</button>
        <button type="button" className={styles.primary} onClick={next}>Continue to dates</button></div>
    </div>}

    {state.stage === "details" && <div className={styles.panel}>
      <h3>When is it due?</h3><p>Dates default to today, just like the full invoice form. Change them if needed.</p>
      <div className={styles.fields}>
        <label className={styles.field}>Invoice date<input type="date" value={state.documentDate}
          onChange={(event) => dispatch({ type: "details", fields: { documentDate: event.target.value } })} /></label>
        <label className={styles.field}>Due date<input type="date" value={state.dueDate}
          onChange={(event) => dispatch({ type: "details", fields: { dueDate: event.target.value } })} /></label>
      </div>
      <details className={styles.optional}><summary>Reference and notes (optional)</summary>
        <label className={styles.field}>Reference<input value={state.reference} maxLength={120}
          onChange={(event) => dispatch({ type: "details", fields: { reference: event.target.value } })} /></label>
        <label className={styles.field}>Notes<textarea value={state.notes} maxLength={500} rows={3}
          onChange={(event) => dispatch({ type: "details", fields: { notes: event.target.value } })} /></label>
      </details>
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => dispatch({ type: "edit", stage: "items" })}>Back</button>
        <button type="button" className={styles.primary} onClick={next}>Review invoice</button></div>
    </div>}

    {["preview", "saving"].includes(state.stage) && <div className={styles.panel}>
      <div className={styles.previewHead}><div><h3>Invoice Preview</h3><p>{state.stage === "saving"
        ? "Saving is in progress. The result is not confirmed yet."
        : "Nothing has been saved yet. Ledgerly will create a draft only after confirmation."}</p></div>
        <span>Draft · not posted</span></div>
      <dl className={styles.summary}><div><dt>Customer</dt><dd>{customer?.name || "—"}</dd></div>
        <div><dt>Invoice date</dt><dd>{state.documentDate}</dd></div><div><dt>Due date</dt><dd>{state.dueDate}</dd></div>
        {state.reference && <div><dt>Reference</dt><dd>{state.reference}</dd></div>}
        {state.notes && <div><dt>Notes</dt><dd>{state.notes}</dd></div>}</dl>
      <div className={styles.previewLines}>{state.lines.map((line, index) => <div key={index}><div><strong>{line.description}</strong>
        <small>{line.quantity} × {money(line.unitPrice)}{line.discount ? ` · ${money(line.discount)} discount` : ""}</small></div>
        <b>{money(totals.details[index]?.total || 0)}</b></div>)}</div>
      <dl className={styles.totals}><div><dt>Subtotal after discount</dt><dd>{money(totals.subtotal)}</dd></div>
        {totals.discount > 0 && <div><dt>Discount included</dt><dd>{money(totals.discount)}</dd></div>}
        <div><dt>VAT</dt><dd>{money(totals.vat)}</dd></div><div className={styles.grand}><dt>Preview total</dt><dd>{money(totals.total)}</dd></div></dl>
      <p className={styles.hint}>Preview uses the same calculation as the full invoice form. Booked amounts remain determined by Ledgerly when posted.</p>
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={state.stage === "saving"}
        onClick={() => dispatch({ type: "edit", stage: "items" })}>Edit items</button>
        <button type="button" className={styles.secondary} disabled={state.stage === "saving"}
          onClick={() => dispatch({ type: "edit", stage: "customer" })}>Change customer</button>
        <button type="button" className={styles.primary} disabled={state.stage === "saving"} onClick={() => void confirm()}>
          {state.stage === "saving" ? "Saving draft…" : "Save as Draft"}</button></div>
    </div>}

    {state.stage === "checking" && <div className={styles.panel} role="status"><h3>Checking draft</h3>
      <p>We&apos;re checking whether your invoice draft was created. Please wait; no second save is being attempted.</p></div>}
    {state.stage === "success" && <div className={`${styles.panel} ${styles.success}`} role="status">
      <h3>{state.recovered ? "Invoice draft found" : "Invoice draft created"}</h3>
      <p><strong>{state.savedNumber}</strong> for {customer?.name || "your customer"}</p>
      <dl className={styles.summary}><div><dt>Preview total</dt><dd>{money(totals.total)}</dd></div>
        <div><dt>Status</dt><dd>Draft · not yet posted or sent</dd></div></dl>
      <div className={styles.actions}><Link className={styles.primary} href={`/sales/invoices/${state.savedId}`}>Open Invoice</Link>
        <button type="button" className={styles.secondary} onClick={another}>Create Another</button>
        <button type="button" className={styles.secondary} onClick={cancel}>Back to Assistant</button></div>
    </div>}
    {state.stage === "uncertain" && <div className={styles.panel} role="alert"><h3>Save result needs checking</h3>
      <p className={styles.error}>{state.error}</p>
      {!state.error.includes("Start a new action") && !state.error.includes("Start this action again") &&
        <p>Retry uses the same request ID. Ledgerly will return the original draft if it was created.</p>}
      <div className={styles.actions}>{!state.error.includes("Start a new action") && !state.error.includes("Start this action again") &&
        <button type="button" className={styles.primary} onClick={() => void confirm()}>Retry safely</button>}
        <Link className={styles.secondary} href="/sales/invoices">Check Sales Invoices</Link>
        <button type="button" className={styles.secondary} onClick={cancel}>Back to Assistant</button></div></div>}
    {state.stage !== "uncertain" && <ActionSwitcher current="create_invoice_draft" allowed={allowed}
      disabled={["saving", "checking"].includes(state.stage)}
      onRequest={(target) => onSwitch(target, state.stage !== "success")} />}
  </section>;
}
