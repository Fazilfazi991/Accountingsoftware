"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAssistantQuotationData, saveAssistantQuotation, type AssistantQuotationData } from "@/app/actions/assistant-quotation";
import { quotationActionCommandSchema, type ActionId } from "@/lib/assistant/action-registry";
import { quotationValidationMessage } from "@/lib/sales-workflow-validation";
import { calculateOperationalTotals } from "@/lib/sales-workflow-totals";
import { dubaiCalendarDate } from "@/lib/dubai-date";
import { CustomerSelector } from "./customer-selector";
import { ActionSwitcher } from "./action-switcher";
import styles from "./guided-invoice.module.css";

type Stage = "customer" | "items" | "details" | "preview" | "saving" | "success" | "uncertain";
type Line = { productId: string; description: string; quantity: number; unitPrice: number; discount: number;
  taxRateId: string; accountId: string };
const money = (value: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(value);
const steps = ["Customer", "Items", "Details", "Preview"];
const fresh = (): Line => ({ productId: "", description: "", quantity: 1, unitPrice: 0, discount: 0,
  taxRateId: "", accountId: "" });

export function GuidedQuotation({ onClose, onSwitch, allowed, initialCustomerId }: {
  onClose: () => void; onSwitch: (target: ActionId, discardRequired: boolean) => void;
  allowed: Record<string, boolean>; initialCustomerId?: string;
}) {
  const [data, setData] = useState<AssistantQuotationData | null>(null), [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState<Stage>("customer"), [customerId, setCustomer] = useState("");
  const [lines, setLines] = useState<Line[]>([fresh()]), [date, setDate] = useState(dubaiCalendarDate()),
    [expiry, setExpiry] = useState(dubaiCalendarDate()), [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""), [error, setError] = useState("");
  const [saved, setSaved] = useState<{ id: string; number: string; status: string } | null>(null);
  const loaded = useRef(false), saving = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void getAssistantQuotationData().then((result) => {
      if ("error" in result) { setLoadError(result.error); return; }
      setData(result);
      if (result.customers.some((item) => item.id === initialCustomerId)) setCustomer(initialCustomerId || "");
    }).catch(() => setLoadError("Quotation choices could not be loaded. Return to Assistant and try again."));
  }, [initialCustomerId]);
  const customer = data?.customers.find((item) => item.id === customerId);
  const totals = calculateOperationalTotals(lines.map((line) => ({ ...line, taxRateId: line.taxRateId || undefined })), data?.taxRates || []);
  const args = () => ({ customerId, date, expiry, reference, notes,
    lines: lines.map((line) => ({ ...line, taxRateId: line.taxRateId || undefined })) });
  const command = () => ({ action: "create_quotation_draft" as const, args: args() });
  function next() {
    setError("");
    if (stage === "customer") {
      if (!customer) { setError("Choose an active customer before continuing."); return; }
      setStage("items"); return;
    }
    if (stage === "items") {
      const checked = quotationActionCommandSchema.shape.args.shape.lines.safeParse(args().lines);
      if (!checked.success) { setError(quotationValidationMessage(checked.error.issues.map((issue) =>
        ({ ...issue, path: ["lines", ...issue.path] })))); return; }
      setStage("details"); return;
    }
    const checked = quotationActionCommandSchema.safeParse(command());
    if (!checked.success) { setError(quotationValidationMessage(checked.error.issues)); return; }
    if (expiry < date) { setError("Valid-until date must not be before quotation date."); return; }
    setStage("preview");
  }
  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); setError("");
  }
  async function confirm() {
    if (saving.current || stage !== "preview" || !data) return;
    const checked = quotationActionCommandSchema.safeParse(command());
    if (!checked.success) { setError(quotationValidationMessage(checked.error.issues)); return; }
    if (expiry < date) { setError("Valid-until date must not be before quotation date."); return; }
    saving.current = true; setStage("saving"); setError("");
    try {
      const result = await saveAssistantQuotation(checked.data, data.branch.id);
      if ("error" in result) {
        if (result.safeToRetry) { saving.current = false; setStage("preview"); setError(result.error); }
        else { setStage("uncertain"); setError("We couldn't confirm the quotation result. Check Quotations before trying again."); }
        return;
      }
      setSaved(result); setStage("success");
    } catch { setStage("uncertain"); setError("We couldn't confirm the quotation result. Check Quotations before trying again."); }
  }
  function another() {
    saving.current = false; setSaved(null); setStage("customer"); setCustomer(""); setLines([fresh()]);
    setDate(dubaiCalendarDate()); setExpiry(dubaiCalendarDate()); setReference(""); setNotes(""); setError("");
  }
  if (loadError) return <section className={styles.flow}><h2>Create Quotation</h2><p role="alert" className={styles.error}>{loadError}</p>
    <button type="button" className={styles.secondary} onClick={onClose}>Back to Assistant</button></section>;
  if (!data) return <section className={styles.flow} role="status"><h2>Create Quotation</h2>
    <p>Loading active customers, products, accounts and sales tax rates…</p></section>;
  return <section className={styles.flow} aria-label="Guided quotation creation">
    <div className={styles.top}><div><h2>Create Quotation</h2><p>Prepare a quotation using Ledgerly&apos;s existing sales workflow.</p></div>
      {!["saving", "uncertain"].includes(stage) && <button type="button" className={styles.textButton} onClick={onClose}>
        {stage === "success" ? "Back to Assistant" : "Cancel"}</button>}</div>
    {!["success", "uncertain"].includes(stage) && <ol className={styles.progress} aria-label="Quotation steps">
      {steps.map((step, index) => <li key={step} className={step.toLowerCase() === stage ? styles.current :
        ["customer", "items", "details", "preview", "saving"].indexOf(stage) > index ? styles.complete : ""}>
        <span>{index + 1}</span>{step}</li>)}</ol>}
    <div className={styles.branch}>Current branch: <strong>{data.branch.name}</strong> · A saved quotation is active, not posted.</div>
    {stage === "customer" && <div className={styles.panel}><h3>Who is this quotation for?</h3>
      <p>Choose an active customer in your company.</p>
      <CustomerSelector customers={data.customers} selectedId={customerId} onChoose={(id) => { setCustomer(id); setError(""); }}
        onAddCustomer={() => onSwitch("create_customer", true)} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button className={styles.primary} type="button" onClick={next}>Continue to items</button></div></div>}
    {stage === "items" && <div className={styles.panel}><h3>Add items or services</h3>
      <p>Enter the product, description, quantity, rate, discount, tax and sales account for each line.</p>
      {lines.map((line, index) => {
        const product = data.products.find((item) => item.id === line.productId);
        return <div className={styles.line} key={index}><div className={styles.lineTop}><strong>Item {index + 1}</strong>
          {lines.length > 1 && <button type="button" className={styles.textButton}
            onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</button>}</div>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.wide}`}>Product / service<select value={line.productId}
              onChange={(event) => {
                const selected = data.products.find((item) => item.id === event.target.value);
                updateLine(index, { productId: event.target.value, description: selected?.name || "",
                  unitPrice: Number(selected?.sales_price || 0), taxRateId: selected?.tax_rate_id || "" });
              }}><option value="">Select product or service</option>{data.products.map((item) => <option value={item.id} key={item.id}>
                {item.name}{item.sku ? ` (${item.sku})` : ""}</option>)}</select></label>
            <label className={`${styles.field} ${styles.wide}`}>Description<input maxLength={300} value={line.description}
              onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
            <label className={styles.field}>Quantity<input type="number" inputMode="decimal" min="0.0001" step="0.0001"
              value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></label>
            <label className={styles.field}>Unit<input value={product?.inventory_units?.code || "—"} readOnly /></label>
            <label className={styles.field}>Rate (AED)<input type="number" inputMode="decimal" min="0" step="0.0001"
              value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: Number(event.target.value) })} /></label>
            <label className={styles.field}>Discount (AED)<input type="number" inputMode="decimal" min="0" step="0.01"
              value={line.discount} onChange={(event) => updateLine(index, { discount: Number(event.target.value) })} /></label>
            <label className={styles.field}>Sales tax<select value={line.taxRateId}
              onChange={(event) => updateLine(index, { taxRateId: event.target.value })}>
              <option value="">No tax</option>{data.taxRates.filter((tax) => tax.sales_enabled).map((tax) => <option key={tax.id} value={tax.id}>
                {tax.name} · {tax.rate_percent}%</option>)}</select></label>
            <label className={styles.field}>Sales account *<select value={line.accountId}
              onChange={(event) => updateLine(index, { accountId: event.target.value })}>
              <option value="">Select account</option>{data.accounts.filter((account) => account.account_type === "income")
                .map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          </div></div>;
      })}
      <button type="button" className={styles.add} onClick={() => setLines((current) => [...current, fresh()])}>+ Add another item</button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setStage("customer")}>Back</button>
        <button type="button" className={styles.primary} onClick={next}>Continue to dates</button></div></div>}
    {stage === "details" && <div className={styles.panel}><h3>When is it valid until?</h3>
      <p>Quotation and valid-until dates default to today, as in the full quotation form.</p>
      <div className={styles.fields}><label className={styles.field}>Quotation date<input type="date" value={date}
        onChange={(event) => setDate(event.target.value)} /></label>
        <label className={styles.field}>Valid until<input type="date" value={expiry}
          onChange={(event) => setExpiry(event.target.value)} /></label></div>
      <details className={styles.optional}><summary>Reference and notes (optional)</summary>
        <label className={styles.field}>Reference<input maxLength={120} value={reference}
          onChange={(event) => setReference(event.target.value)} /></label>
        <label className={styles.field}>Notes<textarea rows={3} maxLength={500} value={notes}
          onChange={(event) => setNotes(event.target.value)} /></label></details>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setStage("items")}>Back</button>
        <button type="button" className={styles.primary} onClick={next}>Review quotation</button></div></div>}
    {["preview", "saving"].includes(stage) && <div className={styles.panel}>
      <div className={styles.previewHead}><div><h3>Quotation Preview</h3><p>{stage === "saving"
        ? "Saving is in progress. The result is not confirmed yet."
        : "Nothing has been saved yet. Confirm to create an active quotation."}</p></div>
        <span>Active quotation · not posted</span></div>
      <dl className={styles.summary}><div><dt>Customer</dt><dd>{customer?.name || "—"}</dd></div>
        <div><dt>Quotation date</dt><dd>{date}</dd></div><div><dt>Valid until</dt><dd>{expiry}</dd></div>
        {reference && <div><dt>Reference</dt><dd>{reference}</dd></div>}
        {notes && <div><dt>Notes</dt><dd>{notes}</dd></div>}</dl>
      <div className={styles.previewLines}>{lines.map((line, index) => <div key={index}><div><strong>{line.description}</strong>
        <small>{line.quantity} × {money(line.unitPrice)}{line.discount ? ` · ${money(line.discount)} discount` : ""}</small></div>
        <b>{money(totals.details[index]?.total || 0)}</b></div>)}</div>
      <dl className={styles.totals}><div><dt>Subtotal after discount</dt><dd>{money(totals.subtotal)}</dd></div>
        {totals.discount > 0 && <div><dt>Discount included</dt><dd>{money(totals.discount)}</dd></div>}
        <div><dt>VAT</dt><dd>{money(totals.vat)}</dd></div><div className={styles.grand}><dt>Preview total</dt><dd>{money(totals.total)}</dd></div></dl>
      <p className={styles.hint}>This preview follows the full quotation list calculation; it creates no journal or stock posting.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={stage === "saving"}
        onClick={() => setStage("items")}>Edit items</button>
        <button type="button" className={styles.secondary} disabled={stage === "saving"}
          onClick={() => setStage("customer")}>Change customer</button>
        <button type="button" className={styles.primary} disabled={stage === "saving"} onClick={() => void confirm()}>
          {stage === "saving" ? "Saving quotation…" : "Save Quotation"}</button></div></div>}
    {stage === "success" && saved && <div className={`${styles.panel} ${styles.success}`} role="status">
      <h3>Quotation created</h3><p><strong>{saved.number}</strong> for {customer?.name || "your customer"}</p>
      <dl className={styles.summary}><div><dt>Preview total</dt><dd>{money(totals.total)}</dd></div>
        <div><dt>Status</dt><dd>{saved.status} · not posted</dd></div></dl>
      <div className={styles.actions}><Link className={styles.primary} href={`/documents/quotation/${saved.id}`}>Open Quotation</Link>
        <button type="button" className={styles.secondary} onClick={another}>Create Another</button>
        <button type="button" className={styles.secondary} onClick={onClose}>Back to Assistant</button></div></div>}
    {stage === "uncertain" && <div className={styles.panel} role="alert"><h3>Save result needs checking</h3>
      <p className={styles.error}>{error}</p><p>No second save will be attempted from this screen.</p>
      <div className={styles.actions}><Link className={styles.primary} href="/sales/quotations">Check Quotations</Link>
        <button type="button" className={styles.secondary} onClick={onClose}>Back to Assistant</button></div></div>}
    {stage !== "uncertain" && <ActionSwitcher current="create_quotation_draft" allowed={allowed}
      disabled={stage === "saving"} onRequest={(target) => onSwitch(target, stage !== "success")} />}
  </section>;
}
