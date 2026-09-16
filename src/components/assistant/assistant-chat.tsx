"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantAnswer, ConversationTurn } from "@/lib/assistant/types";
import { actionRegistry, type ActionId } from "@/lib/assistant/action-registry";
import { GuidedInvoice } from "./guided-invoice";
import { GuidedQuotation } from "./guided-quotation";
import { GuidedCustomer } from "./guided-customer";
import styles from "./assistant-chat.module.css";

const popularQuestions = [
  ["Cash position", "How much money do I have?"],
  ["Who owes me?", "Who owes me?"],
  ["Bills due", "What bills are due?"],
  ["Profit this month", "Did we make profit this month?"],
  ["VAT estimate", "What is my VAT estimate?"],
  ["Needs attention", "Is there anything I should worry about?"],
] as const;

const quickActions: readonly [string, ActionId][] = [
  ["Create Invoice", "create_invoice_draft"],
  ["Create Quotation", "create_quotation_draft"],
  ["Add Customer", "create_customer"],
];

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
}

type Message = { id: number; question: string; response?: AssistantAnswer; error?: string; notice?: string };

export function AssistantChat({ allowed }: { allowed: Record<string, boolean> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [handoffCustomerId, setHandoffCustomerId] = useState<string>();
  const [switchPrompt, setSwitchPrompt] = useState<{ target: ActionId; customerId?: string } | null>(null);
  const [customerOrigin, setCustomerOrigin] = useState<ActionId | null>(null);
  const sequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const hasConversation = messages.length > 0 || pending;

  useEffect(() => {
    const latestExchange = scroll.current?.querySelector<HTMLElement>("[data-assistant-exchange]:last-of-type");
    if (hasConversation && latestExchange) {
      scroll.current?.scrollTo({ top: Math.max(0, latestExchange.offsetTop - 12), behavior: "smooth" });
    }
  }, [hasConversation, messages, pending]);

  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setHistoryOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [historyOpen]);

  function startAction(target: ActionId, customerId?: string) {
    if (!allowed[target] || actionRegistry[target].status !== "available") return;
    if (target === "create_customer") setCustomerOrigin(activeAction);
    setHistoryOpen(false);
    setSwitchPrompt(null);
    setHandoffCustomerId(customerId);
    setActiveAction(target);
  }

  function requestSwitch(target: ActionId, discardRequired: boolean, customerId?: string) {
    if (!allowed[target] || target === activeAction) return;
    if (discardRequired) setSwitchPrompt({ target, customerId });
    else startAction(target, customerId);
  }

  function closeAction() {
    setActiveAction(null);
    setSwitchPrompt(null);
    setHandoffCustomerId(undefined);
    setCustomerOrigin(null);
  }

  const resetConversation = useCallback(() => {
    if (pending || activeAction) return;
    setMessages([]);
    setDraft("");
    setHistoryOpen(false);
  }, [pending, activeAction]);

  async function send(question: string) {
    if (pending || activeAction || question.trim().length < 2) return;
    const text = question.trim().slice(0, 500);
    const id = ++sequence.current;
    const intent = /^(?:please\s+)?(?:create|make|start|new|add|record)\s+(?:an?\s+)?(?:sales\s+)?(invoice|quotation|customer|expense|purchase bill|payment)\b/i.exec(text);
    if (intent) {
      const idByNoun: Record<string, ActionId> = {
        invoice: "create_invoice_draft",
        quotation: "create_quotation_draft",
        customer: "create_customer",
        expense: "create_expense_draft",
        "purchase bill": "create_purchase_bill_draft",
        payment: "record_payment",
      };
      const target = idByNoun[intent[1].toLowerCase()];
      setDraft("");
      if (actionRegistry[target].status === "available" && allowed[target]) startAction(target);
      else setMessages((current) => [...current, { id, question: text, notice: actionRegistry[target].status === "available"
        ? `You do not have permission to ${actionRegistry[target].label.toLowerCase()}.`
        : actionRegistry[target].status === "deferred"
          ? "Payment recording is deferred. Use FYNTA's full workflow with its review and audit controls."
          : "That guided action is coming next. Use the full FYNTA form for now." }]);
      return;
    }

    const turns: ConversationTurn[] = messages
      .filter((message) => message.response?.toolUsed && message.response.status !== "insufficient_data")
      .slice(-8)
      .map((message) => ({ question: message.question, tool: message.response!.toolUsed!, args: message.response!.resolvedArgs }));
    setMessages((current) => [...current, { id, question: text }]);
    setDraft("");
    setPending(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, turns }),
      });
      const data = await response.json();
      if (!response.ok || !data.answer) throw Error(data.error || "The Assistant couldn't answer right now.");
      setMessages((current) => current.map((message) => message.id === id ? { ...message, response: data as AssistantAnswer } : message));
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === id
        ? { ...message, error: error instanceof Error ? error.message : "Please try again." }
        : message));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function composer(placement: "empty" | "active") {
    return <form className={`${styles.composer} ${placement === "empty" ? styles.emptyComposer : styles.activeComposer}`} onSubmit={submit}>
      <label htmlFor="assistant-question" className={styles.srOnly}>Ask FYNTA</label>
      <textarea id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)}
        onInput={(event) => {
          const element = event.currentTarget;
          element.style.height = "auto";
          element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send(draft);
          }
        }}
        maxLength={500} rows={1} placeholder="Ask about your business or start an action..." />
      <button type="submit" aria-label={pending ? "Checking recorded data" : "Send message"}
        disabled={pending || draft.trim().length < 2}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      </button>
    </form>;
  }

  const historyTitle = messages[0]?.question || "New conversation";

  return <div className={styles.page}>
    <section className={styles.workspace} aria-label="Ask FYNTA workspace">
      <header className={styles.header}>
        <div>
          <h1>Ask FYNTA</h1>
          <p>Your business assistant</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.historyButton} aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((current) => !current)}>History</button>
          <button type="button" className={styles.newConversation} onClick={resetConversation}
            disabled={pending || Boolean(activeAction)}><PlusIcon /> New conversation</button>
        </div>
      </header>

      {historyOpen && <>
        <button type="button" className={styles.historyBackdrop} aria-label="Close history" onClick={() => setHistoryOpen(false)} />
        <aside className={styles.historyDrawer} role="dialog" aria-modal="true" aria-labelledby="assistant-history-title">
          <div className={styles.historyHeader}>
            <div><h2 id="assistant-history-title">History</h2><p>This session</p></div>
            <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)}><CloseIcon /></button>
          </div>
          <div className={styles.historyList}>
            {messages.length > 0 ? <button type="button" className={styles.historyItem} onClick={() => setHistoryOpen(false)}>
              <strong>{historyTitle}</strong>
              <span>{messages.length} {messages.length === 1 ? "question" : "questions"} · Current</span>
            </button> : <div className={styles.historyEmpty}>
              <strong>No conversations yet</strong>
              <p>Your current session will appear here after you ask a question.</p>
            </div>}
          </div>
        </aside>
      </>}

      <div ref={scroll} className={`${styles.conversation} ${!hasConversation && !activeAction ? styles.emptyConversation : ""} ${activeAction ? styles.actionConversation : ""}`}
        role="log" aria-label="Assistant conversation" aria-live="polite">
        {activeAction === "create_invoice_draft" && <div className={styles.actionWorkspace}><GuidedInvoice
          key={`${activeAction}:${handoffCustomerId || ""}`} onClose={closeAction} onSwitch={requestSwitch}
          allowed={allowed} initialCustomerId={handoffCustomerId} /></div>}
        {activeAction === "create_quotation_draft" && <div className={styles.actionWorkspace}><GuidedQuotation
          key={`${activeAction}:${handoffCustomerId || ""}`} onClose={closeAction} onSwitch={requestSwitch}
          allowed={allowed} initialCustomerId={handoffCustomerId} /></div>}
        {activeAction === "create_customer" && <div className={styles.actionWorkspace}><GuidedCustomer
          onClose={closeAction} onSwitch={requestSwitch} allowed={allowed} returnTo={customerOrigin} /></div>}

        {switchPrompt && activeAction && <div className={styles.switchOverlay} role="dialog" aria-modal="true"
          onKeyDown={(event) => { if (event.key === "Escape") setSwitchPrompt(null); }}
          aria-labelledby="assistant-switch-title"><div className={styles.switchDialog}>
          <h2 id="assistant-switch-title">Discard this unsaved {activeAction === "create_customer" ? "customer" :
            activeAction === "create_quotation_draft" ? "quotation" : "invoice"} and {
            switchPrompt.target === "create_customer" ? "add a customer" : switchPrompt.target === "create_quotation_draft"
              ? "start a quotation" : "start an invoice"}?</h2>
          <p>Your unsaved guided entries will be cleared. No record is created by switching.</p>
          <div><button type="button" autoFocus onClick={() => setSwitchPrompt(null)}>Keep editing</button>
            <button type="button" onClick={() => startAction(switchPrompt.target, switchPrompt.customerId)}>Discard &amp; continue</button></div>
        </div></div>}

        {!activeAction && messages.length === 0 && <section className={styles.welcome}>
          <div className={styles.welcomeIntro}>
            <h2>What would you like to do today?</h2>
            <p>Ask about your business, find something, or create it.</p>
          </div>
          {composer("empty")}
          <div className={styles.startSection}>
            <h3>Popular questions</h3>
            <div className={styles.popularQuestions}>
              {popularQuestions.map(([label, prompt]) => <button type="button" key={label} onClick={() => void send(prompt)}>{label}</button>)}
            </div>
          </div>
          <div className={styles.startSection}>
            <h3>Quick actions</h3>
            <div className={styles.quickActions}>
              {quickActions.map(([label, action]) => <button type="button" key={action}
                disabled={!allowed[action] || actionRegistry[action].status !== "available"}
                onClick={() => startAction(action)}><PlusIcon />{label}</button>)}
            </div>
            <p className={styles.comingSoon}>More actions coming soon</p>
          </div>
        </section>}

        {!activeAction && messages.map((message) => <article className={styles.exchange} data-assistant-exchange key={message.id}>
          <div className={styles.userTurn}><span>You</span><p>{message.question}</p></div>
          {message.response && <AnswerCard response={message.response} onPrompt={(prompt) => void send(prompt)} />}
          {message.error && <div role="alert" className={styles.error}>{message.error}
            <button type="button" onClick={() => void send(message.question)}>Retry</button></div>}
          {message.notice && <div className={styles.notice}>{message.notice}</div>}
        </article>)}
        {!activeAction && pending && <div className={styles.loading} role="status"><span />Checking recorded data…</div>}
      </div>

      {!activeAction && hasConversation && composer("active")}
      {activeAction && <div className={styles.actionFooter}>No record is created until you explicitly confirm the preview.</div>}
    </section>
  </div>;
}

function AnswerCard({ response, onPrompt }: { response: AssistantAnswer; onPrompt: (prompt: string) => void }) {
  return <section className={`${styles.answer} ${response.status === "insufficient_data" ? styles.insufficient : ""}`}>
    <div className={styles.answerTop}>
      <strong>FYNTA</strong>
      <span className={styles.status}>{response.status === "verified" ? "From recorded data" :
        response.status === "estimate" ? "Estimate · review before filing" : "Insufficient data"}</span>
    </div>
    <p className={styles.answerText}>{response.answer}</p>
    {response.facts.length > 0 && <div className={styles.facts}>{response.facts.map((fact, index) => <div key={`${fact.label}-${index}`}>
      <span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div>}
    {response.rows.length > 0 && <div className={styles.rows}>{response.rows.map((row, index) => <div className={styles.row} key={`${row.label}-${index}`}>
      <div><strong>{row.label}</strong><small>{row.detail}</small></div>
      <div className={styles.rowRight}>{row.amount && <b>{row.amount}</b>}{row.href && <Link href={row.href}>View record <ExternalLinkIcon /></Link>}</div>
    </div>)}</div>}
    {(response.calculation.length > 0 || response.sources.length > 0) && <details className={styles.disclosure}>
      <summary>How this was calculated · Sources</summary>
      {response.calculation.length > 0 && <div className={styles.calc}>{response.calculation.map((line, index) => <div key={`${line.label}-${index}`}>
        <span>{line.label}</span><strong>{line.value}</strong></div>)}</div>}
      {response.sources.map((source, index) => <p className={styles.source} key={index}>{source}</p>)}
    </details>}
    {response.actions.length > 0 && <div className={styles.actions}>{response.actions.map((action) => <Link key={action.href} href={action.href}>
      {action.label} <ExternalLinkIcon /></Link>)}</div>}
    {response.followUpSuggestions.length > 0 && <div className={styles.followUps}>{response.followUpSuggestions.map((prompt) => <button
      type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>)}</div>}
  </section>;
}
