"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAssistantCustomerData, saveAssistantCustomer, type AssistantCustomerData } from "@/app/actions/assistant-customer";
import { customerActionCommandSchema, type ActionId } from "@/lib/assistant/action-registry";
import { customerValidationMessage } from "@/lib/party-validation";
import { likelyCustomerDuplicates, type CustomerDuplicate } from "@/lib/assistant/customer-duplicates";
import { acquireAssistantRequestKey, clearAssistantRequestKey, rotateAssistantRequestKey } from "@/lib/assistant/client-request-key";
import { ActionSwitcher } from "./action-switcher";
import styles from "./guided-invoice.module.css";

type Stage = "form" | "preview" | "duplicate" | "saving" | "success" | "uncertain";
type Fields = { name: string; paymentTermsDays: number; email: string; phone: string; trn: string; address: string };
const blank = (): Fields => ({ name: "", paymentTermsDays: 0, email: "", phone: "", trn: "", address: "" });

export function GuidedCustomer({ onClose, onSwitch, allowed, returnTo }: {
  onClose: () => void; onSwitch: (target: ActionId, discardRequired: boolean, customerId?: string) => void;
  allowed: Record<string, boolean>; returnTo: ActionId | null;
}) {
  const [data, setData] = useState<AssistantCustomerData | null>(null), [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState<Stage>("form"), [fields, setFields] = useState<Fields>(blank());
  const [error, setError] = useState(""), [duplicates, setDuplicates] = useState<CustomerDuplicate[]>([]);
  const [saved, setSaved] = useState<{ id: string; name: string; email: string; phone: string; trn: string } | null>(null);
  const loaded = useRef(false), saving = useRef(false), requestKey = useRef("");
  useEffect(() => {
    if (loaded.current) return; loaded.current = true;
    void getAssistantCustomerData().then((result) => {
      if ("error" in result) { setLoadError(result.error); return; } setData(result);
      requestKey.current = acquireAssistantRequestKey("create_customer", result.branch.id);
    }).catch(() => setLoadError("Customer choices could not be loaded. Return to Assistant and try again."));
  }, []);
  const command = () => ({ action: "create_customer" as const, args: fields });
  const exactNameTaken = data?.customers.some((item) => item.name === fields.name.trim()) || false;
  function update(patch: Partial<Fields>) { setFields((current) => ({ ...current, ...patch })); setError(""); setDuplicates([]); }
  function review() {
    const checked = customerActionCommandSchema.safeParse(command());
    if (!checked.success) { setError(customerValidationMessage(checked.error.issues)); return; }
    if (data) setDuplicates(likelyCustomerDuplicates(checked.data.args, data.customers));
    setError(""); setStage("preview");
  }
  async function confirm(continueAnyway = false) {
    if (saving.current || !data || !["preview", "duplicate", "uncertain"].includes(stage)) return;
    const checked = customerActionCommandSchema.safeParse(command());
    if (!checked.success) { setError(customerValidationMessage(checked.error.issues)); setStage("form"); return; }
    saving.current = true; setError(""); setStage("saving");
    try {
      const result = await saveAssistantCustomer(checked.data, data.branch.id, continueAnyway, requestKey.current);
      if ("duplicateWarning" in result) {
        setDuplicates(result.duplicateWarning); saving.current = false; setStage("duplicate"); return;
      }
      if ("error" in result) {
        if (result.safeToRetry) { saving.current = false; setStage("preview"); setError(result.error); }
        else { saving.current = false; setStage("uncertain"); setError(result.error); }
        return;
      }
      setSaved(result); setStage("success");
    } catch { saving.current = false; setStage("uncertain");
      setError("The create response was lost. Retry with this same request ID; it cannot create another customer."); }
  }
  function another() { if (data) requestKey.current = rotateAssistantRequestKey("create_customer", data.branch.id);
    saving.current = false; setStage("form"); setFields(blank()); setError(""); setDuplicates([]); setSaved(null); }
  function close() { if (data && stage !== "uncertain") clearAssistantRequestKey("create_customer", data.branch.id); onClose(); }
  if (loadError) return <section className={styles.flow}><h2>Add Customer</h2><p role="alert" className={styles.error}>{loadError}</p>
    <button type="button" className={styles.secondary} onClick={close}>Back to Assistant</button></section>;
  if (!data) return <section className={styles.flow} role="status"><h2>Add Customer</h2><p>Checking existing customers…</p></section>;
  return <section className={styles.flow} aria-label="Guided customer creation">
    <div className={styles.top}><div><h2>Add Customer</h2><p>Add a customer using FYNTA&apos;s existing customer form rules.</p></div>
      {!["saving", "uncertain"].includes(stage) && <button type="button" className={styles.textButton} onClick={close}>
        {stage === "success" ? "Back to Assistant" : "Cancel"}</button>}</div>
    <div className={styles.branch}>Current branch: <strong>{data.branch.name}</strong> · Saved in your current company.</div>
    {stage === "form" && <div className={styles.panel}><h3>Customer details</h3>
      <p>Only a name and payment terms are required. You can add contact details now or in the full customer form later.</p>
      <div className={styles.fields}><label className={`${styles.field} ${styles.wide}`}>Customer name *<input autoFocus
        maxLength={160} value={fields.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label className={styles.field}>Payment terms (days) *<input type="number" inputMode="numeric" min="0" max="3650" step="1"
          value={fields.paymentTermsDays} onChange={(event) => update({ paymentTermsDays: Number(event.target.value) })} /></label></div>
      <details className={styles.optional}><summary>Add contact and business details (optional)</summary>
        <div className={styles.fields}><label className={styles.field}>Email<input type="email" value={fields.email}
          onChange={(event) => update({ email: event.target.value })} /></label>
          <label className={styles.field}>Phone<input type="tel" maxLength={40} value={fields.phone}
            onChange={(event) => update({ phone: event.target.value })} /></label>
          <label className={styles.field}>TRN<input maxLength={30} value={fields.trn}
            onChange={(event) => update({ trn: event.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>Billing address<textarea maxLength={500} rows={3}
            value={fields.address} onChange={(event) => update({ address: event.target.value })} /></label></div></details>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><Link className={styles.secondary} href="/sales/customers/new">Full customer form</Link>
        <button className={styles.primary} type="button" onClick={review}>Review customer</button></div></div>}
    {["preview", "duplicate", "saving"].includes(stage) && <div className={styles.panel}>
      <div className={styles.previewHead}><div><h3>Customer Preview</h3><p>{stage === "saving"
        ? "Saving is in progress. The result is not confirmed yet."
        : "No record has been saved. Review these details before creating the customer."}</p></div>
        <span>New customer · not saved</span></div>
      <dl className={styles.summary}><div><dt>Customer</dt><dd>{fields.name.trim()}</dd></div>
        <div><dt>Payment terms</dt><dd>{fields.paymentTermsDays} days</dd></div>
        {fields.email && <div><dt>Email</dt><dd>{fields.email}</dd></div>}
        {fields.phone && <div><dt>Phone</dt><dd>{fields.phone}</dd></div>}
        {fields.trn && <div><dt>TRN</dt><dd>{fields.trn}</dd></div>}
        {fields.address && <div><dt>Billing address</dt><dd>{fields.address}</dd></div>}</dl>
      {duplicates.length > 0 && <div className={styles.duplicate} role="status"><h4>A similar customer already exists.</h4>
        <p>Review these matches before creating another. This is an advisory check, not a new restriction.</p>
        {duplicates.map((item) => <div className={styles.duplicateRow} key={item.id}><div><strong>{item.name}</strong>
          <small>{item.active ? "Active" : "Inactive"} · Matching {item.reasons.join(", ")}</small></div>
          {item.active && returnTo && allowed[returnTo] && <button type="button" className={styles.secondary}
            onClick={() => onSwitch(returnTo, false, item.id)}>Use Existing</button>}
          {item.active && !returnTo && <Link className={styles.secondary} href={`/sales/customers#customer-${item.id}`}>Use Existing</Link>}
          {!item.active && <Link className={styles.secondary} href={`/sales/customers#customer-${item.id}`}>View Existing</Link>}</div>)}</div>}
      {exactNameTaken && <p className={styles.error} role="alert">This exact customer name is already in use. Edit the name or use the existing customer.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={stage === "saving"}
        onClick={() => { setStage("form"); setError(""); }}>Edit</button>
        {stage === "duplicate" ? <button type="button" className={styles.primary} disabled={exactNameTaken} onClick={() => void confirm(true)}>
          Continue Anyway &amp; Create</button> : stage === "preview" && duplicates.length > 0 && !exactNameTaken
          ? <button type="button" className={styles.primary} onClick={() => setStage("duplicate")}>Review Similar Customers</button>
          : <button type="button" className={styles.primary} disabled={stage === "saving" || exactNameTaken}
            onClick={() => void confirm()}>{stage === "saving" ? "Creating customer…" : "Create Customer"}</button>}</div></div>}
    {stage === "success" && saved && <div className={`${styles.panel} ${styles.success}`} role="status">
      <h3>Customer created</h3><p><strong>{saved.name}</strong> is ready to use in this company.</p>
      <dl className={styles.summary}>{saved.email && <div><dt>Email</dt><dd>{saved.email}</dd></div>}
        {saved.phone && <div><dt>Phone</dt><dd>{saved.phone}</dd></div>}
        {saved.trn && <div><dt>TRN</dt><dd>{saved.trn}</dd></div>}</dl>
      <div className={styles.actions}><Link className={styles.primary} href={`/sales/customers#customer-${saved.id}`}>Open Customer</Link>
        <button type="button" className={styles.secondary} disabled={!allowed.create_invoice_draft}
          onClick={() => onSwitch("create_invoice_draft", false, saved.id)}>Create Invoice for this Customer</button>
        <button type="button" className={styles.secondary} disabled={!allowed.create_quotation_draft}
          onClick={() => onSwitch("create_quotation_draft", false, saved.id)}>Create Quotation for this Customer</button>
        <button type="button" className={styles.secondary} onClick={another}>Add Another</button>
        <button type="button" className={styles.secondary} onClick={close}>Back to Assistant</button></div></div>}
    {stage === "uncertain" && <div className={styles.panel} role="alert"><h3>Creation result needs checking</h3>
      <p className={styles.error}>{error}</p>
      {!error.includes("Start a new action") && !error.includes("Start this action again") &&
        <p>Retry uses the same request ID and will return the original customer if it was created.</p>}
      <div className={styles.actions}>{!error.includes("Start a new action") && !error.includes("Start this action again") &&
        <button type="button" className={styles.primary} onClick={() => void confirm(true)}>Retry safely</button>}
        <Link className={styles.secondary} href="/sales/customers">Check Customers</Link>
        <button type="button" className={styles.secondary} onClick={close}>Back to Assistant</button></div></div>}
    {stage !== "uncertain" && <ActionSwitcher current="create_customer" allowed={allowed} disabled={stage === "saving"}
      onRequest={(target) => onSwitch(target, stage !== "success")} />}
  </section>;
}
