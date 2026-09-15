"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantAnswer, ConversationTurn } from "@/lib/assistant/types";
import styles from "./assistant-chat.module.css";

const prompts = ["What needs my attention today?", "Who owes me money?", "What bills are due this week?",
  "How is this month going?", "Why is my cash lower?", "What happened yesterday?"];
type Message = { id: number; question: string; response?: AssistantAnswer; error?: string };

export function AssistantChat({ organization, branch }: { organization: string; branch: string }) {
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(""), [pending, setPending] = useState(false);
  const sequence = useRef(0), scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [messages, pending]);
  async function send(question: string) {
    if (pending || question.trim().length < 2) return;
    const text = question.trim().slice(0, 500), id = ++sequence.current;
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
  return <main className={styles.page}>
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div><Link href="/" className={styles.back}>← Back to Ledgerly</Link>
          <span className={styles.eyebrow}>YOUR BUSINESS, IN CONTEXT</span>
          <h1>Ledgerly Assistant</h1><p>Ask a question. See the recorded facts, calculation and next useful screen.</p></div>
        <div className={styles.identity}><strong>{organization}</strong><span>{branch} · Read-only</span></div>
      </header>
      <div ref={scroll} className={styles.conversation} role="log" aria-label="Assistant conversation" aria-live="polite">
        {messages.length === 0 && <section className={styles.welcome}>
          <span className={styles.trust}>Grounded in your Ledgerly records</span>
          <h2>What would you like to understand?</h2>
          <p>Answers come from selected-branch accounting reports, not guessed figures. If data is missing, I’ll say so.</p>
          <div className={styles.prompts}>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>
        </section>}
        {messages.map((m) => <div className={styles.exchange} key={m.id}>
          <div className={styles.userMessage}>{m.question}</div>
          {m.response && <AnswerCard response={m.response} onPrompt={(p) => void send(p)} />}
          {m.error && <div role="alert" className={styles.error}>{m.error} <button type="button" onClick={() => void send(m.question)}>Retry</button></div>}
        </div>)}
        {pending && <div className={styles.loading} role="status">Checking recorded data…</div>}
      </div>
      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="assistant-question" className={styles.srOnly}>Ask Ledgerly</label>
        <textarea ref={input} id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          maxLength={500} rows={2} placeholder="Ask about cash, customers, bills, sales…" />
        <button type="submit" disabled={pending || draft.trim().length < 2}>Ask Ledgerly <span aria-hidden="true">→</span></button>
        <small>Read-only · Ledgerly never changes your records here.</small>
      </form>
    </div>
  </main>;
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
