"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantAnswer, ConversationTurn } from "@/lib/assistant/types";
import { actionRegistry } from "@/lib/assistant/action-registry";
import { GuidedInvoice } from "./guided-invoice";
import styles from "./assistant-chat.module.css";

const prompts = [
  ["Cash position", "How much money do I have?"], ["Money customers owe", "Who owes me money?"],
  ["Bills due", "What bills are due this week?"], ["Profit this month", "Did we make profit this month?"],
  ["VAT estimate", "How much VAT might I owe?"], ["Needs attention", "What needs my attention today?"],
] as const;
type Message = { id: number; question: string; response?: AssistantAnswer; error?: string; notice?: string };

export function AssistantChat({ organization, branch, providerConfigured = false, invoiceAllowed = false }: {
  organization: string; branch: string; providerConfigured?: boolean; invoiceAllowed?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(""), [pending, setPending] = useState(false),
    [invoiceActive, setInvoiceActive] = useState(false);
  const sequence = useRef(0), scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (messages.length > 0 || pending) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);
  async function send(question: string) {
    if (pending || invoiceActive || question.trim().length < 2) return;
    const text = question.trim().slice(0, 500), id = ++sequence.current;
    if (/^(?:please\s+)?(?:create|make|start|new)\s+(?:an?\s+)?(?:sales\s+)?invoice\b/i.test(text)) {
      setDraft("");
      if (invoiceAllowed) setInvoiceActive(true);
      else setMessages((current) => [...current, { id, question: text, notice: "You do not have permission to create sales invoices." }]);
      return;
    }
    if (/^(?:please\s+)?(?:create|make|add|record)\s+(?:an?\s+)?(?:quotation|customer|expense|purchase bill|payment)\b/i.test(text)) {
      setDraft(""); setMessages((current) => [...current, { id, question: text,
        notice: "That guided action is coming next. Use the full Ledgerly form for now." }]); return;
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
      <header className={styles.header}>
        <div><Link href="/" className={styles.back}>← Back to Ledgerly</Link>
          <h1>Ask Ledgerly</h1><p>Check your business, find records, or create something.</p>
          <span className={styles.mobileIdentity}>{branch} · Guided financial assistant</span></div>
        <div className={styles.identity}><strong>{organization}</strong><span>{branch} · Guided financial assistant</span></div>
      </header>
      <div ref={scroll} className={styles.conversation} role="log" aria-label="Assistant conversation" aria-live="polite">
        {invoiceActive && <GuidedInvoice onClose={() => setInvoiceActive(false)} />}
        {!invoiceActive && messages.length === 0 && <section className={styles.welcome}>
          <span className={styles.trust}>{providerConfigured ? "Grounded in Ledgerly records" : "Guided financial assistant · no AI required"}</span>
          <h2>What would you like to do?</h2>
          <p>Financial answers use your selected-branch records. Creation uses guided fields, a preview, and your confirmation.</p>
          <div className={styles.startGroup}><div className={styles.groupHeading}><h3>Ask about your business</h3><span>Read-only answers</span></div>
            <div className={styles.prompts}>{prompts.map(([label, prompt]) => <button type="button" key={prompt} onClick={() => void send(prompt)}>
              {label}<span aria-hidden="true">↗</span></button>)}</div></div>
          <div className={styles.startGroup}><div className={styles.groupHeading}><h3>Create</h3><span>Review before saving</span></div>
            <div className={styles.createGrid}>{Object.values(actionRegistry).map((action) => <button type="button" key={action.id}
              disabled={action.status !== "available" || !invoiceAllowed} onClick={() => setInvoiceActive(true)}
              aria-label={`${action.label}${action.status !== "available" ? ", coming next" : !invoiceAllowed ? ", unavailable with your permissions" : ""}`}>
              <strong>{action.label}</strong><small>{action.status === "available" && invoiceAllowed ? "Guided draft" : action.status === "available" ? "No permission" : "Coming next"}</small>
            </button>)}</div></div>
        </section>}
        {!invoiceActive && messages.map((m) => <div className={styles.exchange} key={m.id}>
          <div className={styles.userMessage}>{m.question}</div>
          {m.response && <AnswerCard response={m.response} onPrompt={(p) => void send(p)} />}
          {m.error && <div role="alert" className={styles.error}>{m.error} <button type="button" onClick={() => void send(m.question)}>Retry</button></div>}
          {m.notice && <div className={styles.notice}>{m.notice}</div>}
        </div>)}
        {!invoiceActive && pending && <div className={styles.loading} role="status">Checking recorded data…</div>}
      </div>
      {!invoiceActive ? <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="assistant-question" className={styles.srOnly}>Ask Ledgerly</label>
        <textarea ref={input} id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          maxLength={500} rows={2} placeholder="Ask about cash, customers, bills, sales…" />
        <button type="submit" disabled={pending || draft.trim().length < 2}>Ask Ledgerly <span aria-hidden="true">→</span></button>
        <small>Financial answers are read-only. Guided creation saves only after your confirmation.
          {invoiceAllowed && <button type="button" className={styles.composerAction} onClick={() => setInvoiceActive(true)}>Create Invoice</button>}</small>
      </form> : <div className={styles.actionFooter}>Guided Create Invoice · No record is created until you select Save as Draft.</div>}
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
