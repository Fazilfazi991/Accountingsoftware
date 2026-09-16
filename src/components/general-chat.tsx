"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./general-chat.module.css";

type Message = { id: number; role: "user" | "assistant"; content: string; pending?: boolean; error?: string };
const starters = [
  ["Explain something to me", "Explain something to me"],
  ["Help me write something", "Help me write something"],
  ["Summarize information", "Summarize information"],
  ["Help me plan", "Help me plan"],
] as const;
const recent = [
  ["New conversation", "Just now"],
  ["Writing a clear project update", "Yesterday"],
  ["Plan a weekend trip", "Sep 14, 2026"],
  ["Explain compound interest", "Sep 12, 2026"],
] as const;

export function GeneralChat({ organization, branch }: { organization: string; branch: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length || pending) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function resetConversation() {
    if (pending) return;
    setMessages([]); setDraft(""); setHistoryOpen(false);
    requestAnimationFrame(() => input.current?.focus());
  }
  async function send(value: string) {
    if (pending || value.trim().length < 2) return;
    const content = value.trim().slice(0, 1200), id = ++sequence.current;
    const prior = messages.filter((item) => !item.pending && !item.error).slice(-12).map(({ role, content: text }) => ({ role, content: text }));
    setMessages((current) => [...current, { id, role: "user", content }, { id: id + .5, role: "assistant", content: "", pending: true }]);
    setDraft(""); setPending(true);
    try {
      const response = await fetch("/api/general", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: content, turns: prior }) });
      const data = await response.json();
      if (!response.ok || typeof data.answer !== "string") throw Error(data.error || "Ask General is unavailable right now.");
      setMessages((current) => current.map((item) => item.id === id + .5 ? { id: item.id, role: "assistant", content: data.answer } : item));
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === id + .5 ? { id: item.id, role: "assistant", content: "", error: error instanceof Error ? error.message : "Please try again." } : item));
    } finally { setPending(false); input.current?.focus(); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }

  return <div className={styles.page}>
    <div className={styles.workspace}>
      <aside className={`${styles.historySidebar} ${historyOpen ? styles.historyOpen : ""}`} aria-label="General conversations">
        <div className={styles.historyHeading}><h2>Conversations</h2><button type="button" aria-label="New conversation" onClick={resetConversation}>＋</button></div>
        <div className={styles.historyList}>{recent.map(([title, date], index) => <button type="button" key={title} className={`${styles.historyItem} ${index === 0 ? styles.historyCurrent : ""}`} onClick={() => index === 0 ? resetConversation() : undefined}>
          <strong>{title}</strong><small>{date}</small>
        </button>)}</div>
      </aside>
      {historyOpen && <button type="button" className={styles.historyBackdrop} aria-label="Close conversations" onClick={() => setHistoryOpen(false)} />}
      <main className={styles.main}>
        <header className={styles.header}>
          <div><h1>Ask General</h1><p>Ask questions, get explanations, and work through everyday tasks.</p><span>{organization} · {branch}</span></div>
          <div className={styles.headerActions}><button type="button" className={styles.historyButton} onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>History</button><button type="button" className={styles.newButton} onClick={resetConversation} disabled={pending}>New conversation</button></div>
        </header>
        <div ref={scroll} className={styles.conversation} role="log" aria-label="General conversation" aria-live="polite">
          <div className={styles.starterRow}>{starters.map(([label, prompt]) => <button type="button" key={label} onClick={() => void send(prompt)}>{label}<span aria-hidden="true">→</span></button>)}</div>
          {messages.length === 0 && <section className={styles.empty}><div className={styles.avatar} aria-hidden="true">L</div><h2>What would you like to work through?</h2><p>Ask anything, and we&apos;ll take it one step at a time.</p></section>}
          {messages.map((message) => <div className={message.role === "user" ? styles.userRow : styles.assistantRow} key={message.id}><div className={message.role === "assistant" ? styles.assistantAvatar : styles.userAvatar} aria-hidden="true">{message.role === "assistant" ? "L" : "You"}</div><div className={styles.message}>{message.pending ? <span className={styles.typing}>Thinking<span>·</span><span>·</span><span>·</span></span> : message.error ? <span role="alert" className={styles.error}>{message.error} <button type="button" onClick={() => void send(messages.find((item) => item.role === "user")?.content || "Help me try again")}>Retry</button></span> : <GeneralText content={message.content} />}</div></div>)}
        </div>
        <form className={styles.composer} onSubmit={submit}><label htmlFor="general-question" className={styles.srOnly}>Ask General</label><textarea ref={input} id="general-question" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} rows={1} maxLength={1200} placeholder="Ask anything…" /><button type="submit" aria-label="Send message" disabled={pending || draft.trim().length < 2}><span aria-hidden="true">↑</span></button><small>Enter to send · Shift+Enter for a new line</small></form>
      </main>
    </div>
  </div>;
}

function GeneralText({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return <div className={styles.text}>{lines.map((line, index) => line.startsWith("- ") ? <div className={styles.listItem} key={index}><span>•</span>{line.slice(2)}</div> : line ? <p key={index}>{line}</p> : <br key={index} />)}</div>;
}
