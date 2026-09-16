"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./general-chat.module.css";

type Message = { id: number; role: "user" | "assistant"; content: string; pending?: boolean; error?: string };
const starters = [
  ["Explain something to me", "Explain something to me"],
  ["Help me write something", "Help me write something"],
  ["Summarize information", "Summarize information"],
  ["Help me plan", "Help me plan"],
] as const;
export function GeneralChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length || pending) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const resetConversation = useCallback(() => {
    if (pending) return;
    setMessages([]); setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }, [pending]);
  useEffect(() => {
    const handler = () => resetConversation();
    window.addEventListener("ledgerly:new-conversation", handler);
    return () => window.removeEventListener("ledgerly:new-conversation", handler);
  }, [resetConversation]);
  async function send(value: string) {
    if (pending || value.trim().length < 2) return;
    const content = value.trim().slice(0, 1200), id = ++sequence.current;
    const prior = messages.filter((item) => !item.pending && !item.error).slice(-12).map(({ role, content: text }) => ({ role, content: text }));
    setMessages((current) => [...current, { id, role: "user", content }, { id: id + .5, role: "assistant", content: "", pending: true }]);
    setDraft(""); setPending(true); if (input.current) input.current.style.height = "";
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
      <main className={styles.main}>
        <div ref={scroll} className={styles.conversation} role="log" aria-label="General conversation" aria-live="polite">
          {messages.length === 0 && <section className={styles.empty}><div className={styles.emptyIntro}><div className={styles.avatar} aria-hidden="true">L</div><div><h1>Ask General</h1><p>Ask questions, get explanations, and work through everyday tasks.</p></div></div><div className={styles.starterRow}>{starters.map(([label, prompt]) => <button type="button" key={label} onClick={() => void send(prompt)}>{label}<span aria-hidden="true">→</span></button>)}</div></section>}
          {messages.map((message) => <div className={message.role === "user" ? styles.userRow : styles.assistantRow} key={message.id}><div className={message.role === "assistant" ? styles.assistantAvatar : styles.userAvatar} aria-hidden="true">{message.role === "assistant" ? "L" : "You"}</div><div className={styles.message}>{message.pending ? <span className={styles.typing}>Thinking<span>·</span><span>·</span><span>·</span></span> : message.error ? <span role="alert" className={styles.error}>{message.error} <button type="button" onClick={() => void send(messages.find((item) => item.role === "user")?.content || "Help me try again")}>Retry</button></span> : <GeneralText content={message.content} />}</div></div>)}
        </div>
        <form className={styles.composer} onSubmit={submit}><label htmlFor="general-question" className={styles.srOnly}>Ask General</label><span className={styles.composerSparkle} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></svg></span><textarea ref={input} id="general-question" value={draft} onChange={(event) => setDraft(event.target.value)} onInput={(event) => { const element = event.currentTarget; element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 150)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} rows={1} maxLength={1200} placeholder="Ask anything..." /><button type="submit" aria-label="Send message" disabled={pending || draft.trim().length < 2}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-3 14-4-5-7-2Z" /><path d="m12 14 7-9" /></svg></button></form>
      </main>
    </div>
  </div>;
}

function GeneralText({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return <div className={styles.text}>{lines.map((line, index) => line.startsWith("- ") ? <div className={styles.listItem} key={index}><span>•</span>{line.slice(2)}</div> : line ? <p key={index}>{line}</p> : <br key={index} />)}</div>;
}
