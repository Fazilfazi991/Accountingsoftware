"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantAnswer, ConversationTurn } from "@/lib/assistant/types";
import { actionRegistry, type ActionId } from "@/lib/assistant/action-registry";
import { GuidedInvoice } from "./guided-invoice";
import { GuidedQuotation } from "./guided-quotation";
import { GuidedCustomer } from "./guided-customer";
import styles from "./assistant-chat.module.css";

const primarySuggestions = [
  ["How much do customers owe me?", "Who owes me money?"],
  ["What bills are due this week?", "What bills are due this week?"],
  ["Create an invoice", "Create an invoice"],
  ["How is my business doing this month?", "Did we make profit this month?"],
] as const;
const secondarySuggestions = [
  ["Create quotation", "Create a quotation", "create_quotation_draft"],
  ["Add customer", "Add a customer", "create_customer"],
  ["Record expense", "Record an expense", "create_expense_draft"],
] as const;
type Message = { id: number; question: string; response?: AssistantAnswer; error?: string; notice?: string };

export function AssistantChat({ allowed }: { allowed: Record<string, boolean> }) {
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(""), [pending, setPending] = useState(false),
    [activeAction, setActiveAction] = useState<ActionId | null>(null), [handoffCustomerId, setHandoffCustomerId] = useState<string>(),
    [switchPrompt, setSwitchPrompt] = useState<{ target: ActionId; customerId?: string } | null>(null),
    [customerOrigin, setCustomerOrigin] = useState<ActionId | null>(null);
  const sequence = useRef(0), scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (messages.length > 0 || pending) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);
  function startAction(target: ActionId, customerId?: string) {
    if (!allowed[target] || actionRegistry[target].status !== "available") return;
    if (target === "create_customer") setCustomerOrigin(activeAction);
    setSwitchPrompt(null); setHandoffCustomerId(customerId); setActiveAction(target);
  }
  function requestSwitch(target: ActionId, discardRequired: boolean, customerId?: string) {
    if (!allowed[target] || target === activeAction) return;
    if (discardRequired) setSwitchPrompt({ target, customerId });
    else startAction(target, customerId);
  }
  function closeAction() { setActiveAction(null); setSwitchPrompt(null); setHandoffCustomerId(undefined); setCustomerOrigin(null); }
  const resetConversation = useCallback(() => {
    if (pending || activeAction) return;
    setMessages([]); setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }, [pending, activeAction]);
  useEffect(() => {
    const handler = () => { if (!pending && !activeAction) resetConversation(); };
    window.addEventListener("ledgerly:new-conversation", handler);
    return () => window.removeEventListener("ledgerly:new-conversation", handler);
  }, [pending, activeAction, resetConversation]);
  async function send(question: string) {
    if (pending || activeAction || question.trim().length < 2) return;
    const text = question.trim().slice(0, 500), id = ++sequence.current;
    const intent = /^(?:please\s+)?(?:create|make|start|new|add|record)\s+(?:an?\s+)?(?:sales\s+)?(invoice|quotation|customer|expense|purchase bill|payment)\b/i.exec(text);
    if (intent) {
      const idByNoun: Record<string, ActionId> = { invoice: "create_invoice_draft", quotation: "create_quotation_draft",
        customer: "create_customer", expense: "create_expense_draft", "purchase bill": "create_purchase_bill_draft",
        payment: "record_payment" };
      const target = idByNoun[intent[1].toLowerCase()]; setDraft("");
      if (actionRegistry[target].status === "available" && allowed[target]) startAction(target);
      else setMessages((current) => [...current, { id, question: text, notice: actionRegistry[target].status === "available"
        ? `You do not have permission to ${actionRegistry[target].label.toLowerCase()}.`
        : actionRegistry[target].status === "deferred" ? "Payment recording is deferred. Use Ledgerly's full workflow with its review and audit controls."
          : "That guided action is coming next. Use the full Ledgerly form for now." }]);
      return;
    }
    const turns: ConversationTurn[] = messages.filter((m) => m.response?.toolUsed && m.response.status !== "insufficient_data")
      .slice(-8).map((m) => ({ question: m.question, tool: m.response!.toolUsed!, args: m.response!.resolvedArgs }));
    setMessages((current) => [...current, { id, question: text }]); setDraft(""); setPending(true);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, turns }) });
      const data = await response.json();
      if (!response.ok || !data.answer) throw Error(data.error || "The Assistant couldn't answer right now.");
      setMessages((current) => current.map((m) => m.id === id ? { ...m, response: data as AssistantAnswer } : m));
    } catch (error) {
      setMessages((current) => current.map((m) => m.id === id ? { ...m, error: error instanceof Error ? error.message : "Please try again." } : m));
    } finally { setPending(false); input.current?.focus(); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }
  return <div className={`${styles.page} ${styles.embedded}`}>
    <div className={styles.workspace}>
      <div ref={scroll} className={styles.conversation} role="log" aria-label="Assistant conversation" aria-live="polite">
        {activeAction === "create_invoice_draft" && <GuidedInvoice key={`${activeAction}:${handoffCustomerId || ""}`}
          onClose={closeAction} onSwitch={requestSwitch} allowed={allowed} initialCustomerId={handoffCustomerId} />}
        {activeAction === "create_quotation_draft" && <GuidedQuotation key={`${activeAction}:${handoffCustomerId || ""}`}
          onClose={closeAction} onSwitch={requestSwitch} allowed={allowed} initialCustomerId={handoffCustomerId} />}
        {activeAction === "create_customer" && <GuidedCustomer onClose={closeAction} onSwitch={requestSwitch} allowed={allowed}
          returnTo={customerOrigin} />}
        {switchPrompt && activeAction && <div className={styles.switchOverlay} role="dialog" aria-modal="true"
          onKeyDown={(event) => { if (event.key === "Escape") setSwitchPrompt(null); }}
          aria-labelledby="assistant-switch-title"><div className={styles.switchDialog}>
          <h2 id="assistant-switch-title">Discard this unsaved {activeAction === "create_customer" ? "customer" :
            activeAction === "create_quotation_draft" ? "quotation" : "invoice"} and {
            switchPrompt.target === "create_customer" ? "add a customer" : switchPrompt.target === "create_quotation_draft"
              ? "start a quotation" : "start an invoice"}?</h2>
          <p>Your unsaved guided entries will be cleared. No record is created by switching.</p>
          <div><button type="button" autoFocus onClick={() => setSwitchPrompt(null)}>Keep Editing</button>
            <button type="button" onClick={() => startAction(switchPrompt.target, switchPrompt.customerId)}>Discard &amp; Continue</button></div>
        </div></div>}
        {!activeAction && messages.length === 0 && <section className={styles.welcome}>
          <div className={styles.welcomeMark} aria-hidden="true">L</div>
          <h1 className={styles.chatTitle}>Ask Ledgerly</h1>
          <h2>What can I help you with?</h2>
          <p>Ask about your business or tell me what you&apos;d like to do.</p>
          <div className={styles.primarySuggestions}>
            {primarySuggestions.map(([label, prompt]) => {
              const action = label === "Create an invoice" ? "create_invoice_draft" : null;
              const unavailable = action ? !allowed[action] || actionRegistry[action].status !== "available" : false;
              return <button type="button" className={`${styles.suggestion} ${action ? styles.actionSuggestion : ""}`} key={label}
                disabled={unavailable} onClick={() => action ? startAction(action) : void send(prompt)}>
                <span>{label}</span><span className={styles.suggestionArrow} aria-hidden="true">{action ? "＋" : "→"}</span>
              </button>;
            })}
          </div>
          <div className={styles.secondarySuggestions} aria-label="More actions">
            {secondarySuggestions.map(([label, prompt, action]) => {
              const unavailable = !allowed[action] || actionRegistry[action].status !== "available";
              return <button type="button" key={label} disabled={unavailable} onClick={() => void send(prompt)}>
                <span aria-hidden="true">＋</span>{label}
              </button>;
            })}
          </div>
        </section>}
        {!activeAction && messages.map((m) => <div className={styles.exchange} key={m.id}>
          <div className={styles.userMessage}>{m.question}</div>
          {m.response && <AnswerCard response={m.response} onPrompt={(p) => void send(p)} />}
          {m.error && <div role="alert" className={styles.error}>{m.error} <button type="button" onClick={() => void send(m.question)}>Retry</button></div>}
          {m.notice && <div className={styles.notice}>{m.notice}</div>}
        </div>)}
        {!activeAction && pending && <div className={styles.loading} role="status">Checking recorded data…</div>}
      </div>
      {!activeAction ? <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="assistant-question" className={styles.srOnly}>Ask Ledgerly</label>
        <span className={styles.composerSparkle} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" /><path d="m19 16 .7 2.3L22 19l-.7-2.3L19 22l-.7-2.3L16 19l2.3-.7z" /></svg></span>
        <textarea ref={input} id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)}
          onInput={(event) => { const element = event.currentTarget; element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 150)}px`; }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          maxLength={500} rows={1} placeholder="Ask Ledgerly anything..." />
        <button type="submit" aria-label={pending ? "Checking" : "Send message"} disabled={pending || draft.trim().length < 2}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-3 14-4-5-7-2Z" /><path d="m12 14 7-9" /></svg></button>
      </form> : <div className={styles.actionFooter}>Guided {actionRegistry[activeAction].label} ·
        No record is created until you explicitly confirm its preview.</div>}
    </div>
  </div>;
}

function AnswerCard({ response, onPrompt }: { response: AssistantAnswer; onPrompt: (prompt: string) => void }) {
  return <article className={`${styles.answer} ${response.status === "insufficient_data" ? styles.insufficient : ""}`}>
    <div className={styles.answerTop}><span className={styles.status}>{response.status === "verified" ? "From recorded data" :
      response.status === "estimate" ? "Estimate · review before filing" : "Insufficient data"}</span></div>
    <p className={styles.answerText}>{response.answer}</p>
    {response.facts.length > 0 && <div className={styles.facts}>{response.facts.map((fact, i) => <div key={`${fact.label}-${i}`}>
      <span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div>}
    {response.rows.length > 0 && <div className={styles.rows}>{response.rows.map((row, i) => <div className={styles.row} key={`${row.label}-${i}`}>
      <div><strong>{row.label}</strong><small>{row.detail}</small></div><div className={styles.rowRight}>{row.amount && <b>{row.amount}</b>}{row.href && <Link href={row.href}>View record ↗</Link>}</div>
    </div>)}</div>}
    {(response.calculation.length > 0 || response.sources.length > 0) && <details className={styles.disclosure}>
      <summary>How was this calculated? · Sources</summary>
      {response.calculation.length > 0 && <div className={styles.calc}>{response.calculation.map((line, i) => <div key={`${line.label}-${i}`}><span>{line.label}</span><strong>{line.value}</strong></div>)}</div>}
      {response.sources.map((source, i) => <p className={styles.source} key={i}>{source}</p>)}
    </details>}
    {response.actions.length > 0 && <div className={styles.actions}>{response.actions.map((action) => <Link key={action.href} href={action.href}>{action.label} <span aria-hidden="true">↗</span></Link>)}</div>}
    {response.followUpSuggestions.length > 0 && <div className={styles.followUps}>{response.followUpSuggestions.map((prompt) => <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>)}</div>}
  </article>;
}
