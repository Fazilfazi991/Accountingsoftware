"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOrganizationContext } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, unknown>;
type DraftLine = { account_id: string; description: string; debit: string; credit: string };
const money = (value: unknown) => `AED ${Number(value || 0).toFixed(2)}`;
const blankLine = (): DraftLine => ({ account_id: "", description: "", debit: "", credit: "" });

export function PostingReports({ view }: { view: "journals" | "trial" | "ledger" }) {
  const { organization } = useOrganizationContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState("2026-12-31");
  useEffect(() => {
    const db = createClient();
    if (view === "journals") void db.from("journal_entries").select("id,journal_number,journal_date,reference,description,status").eq("organization_id", organization.id).order("created_at", { ascending: false }).then(({ data }) => setRows((data ?? []) as Row[]));
    if (view === "trial") void db.rpc("get_trial_balance", { p_organization_id: organization.id }).then(({ data }) => setRows((data ?? []) as Row[]));
    if (view === "ledger") {
      void db.from("accounts").select("id,code,name").eq("organization_id", organization.id).eq("is_active", true).order("code").then(({ data }) => setAccounts((data ?? []) as Row[]));
      const query = new URLSearchParams(window.location.search);
      const selectedAccount = query.get("account") || "";
      const selectedFrom = query.get("from") || "2026-01-01";
      const selectedTo = query.get("to") || "2026-12-31";
      setAccount(selectedAccount); setFrom(selectedFrom); setTo(selectedTo);
      if (selectedAccount) void db.rpc("get_general_ledger", { p_organization_id: organization.id, p_account_id: selectedAccount, p_from: selectedFrom, p_to: selectedTo }).then(({ data }) => setRows((data ?? []) as Row[]));
    }
  }, [view, organization.id]);
  const loadLedger = async () => {
    const { data } = await createClient().rpc("get_general_ledger", { p_organization_id: organization.id, p_account_id: account, p_from: from, p_to: to });
    setRows((data ?? []) as Row[]);
  };
  const columns = view === "journals" ? ["journal_number", "journal_date", "reference", "description", "status"] : view === "trial" ? ["account_code", "account_name", "debit", "credit"] : ["journal_date", "journal_number", "reference", "description", "debit", "credit", "running_balance"];
  return <section className="panel"><div className="panel-head"><div><h2>{view === "journals" ? "Journal Entries" : view === "trial" ? "Trial Balance" : "General Ledger"}</h2><p>Posted journal lines only.</p></div>{view === "journals" && <Link className="button" href="/accounting/journals/new">New Journal</Link>}</div>{view === "ledger" && <div className="report-toolbar"><select value={account} onChange={(event) => setAccount(event.target.value)}><option value="">Select account</option>{accounts.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.code)} · {String(item.name)}</option>)}</select><input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} /> <button className="button" disabled={!account} onClick={() => void loadLedger()}>Run report</button></div>}<table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}{view === "journals" && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || index)}>{columns.map((column) => <td key={column}>{["debit", "credit", "running_balance"].includes(column) ? money(row[column]) : String(row[column] ?? "—")}</td>)}{view === "journals" && <td><Link className="text-button" href={`/accounting/journals/${String(row.id)}`}>View</Link></td>}</tr>)}</tbody></table></section>;
}

export function JournalDetail({ id }: { id: string }) {
  const { organization } = useOrganizationContext();
  const [journal, setJournal] = useState<Row | null>(null);
  const [notice, setNotice] = useState("");
  const load = () => void createClient().from("journal_entries").select("*,journal_lines(*,accounts(code,name))").eq("organization_id", organization.id).eq("id", id).single().then(({ data }) => setJournal(data as Row | null));
  useEffect(load, [id, organization.id]);
  if (!journal) return <section className="panel">Loading journal…</section>;
  const action = async (name: "post_journal_entry" | "delete_journal_draft" | "reverse_journal_entry") => {
    const { error } = await createClient().rpc(name, { p_organization_id: organization.id, p_journal_id: id });
    setNotice(error ? error.message : name === "delete_journal_draft" ? "Draft deleted." : "Saved.");
    if (!error) load();
  };
  const lines = (journal.journal_lines as Row[]) || [];
  const related = journal.reversal_of_id || journal.reversed_by_id;
  return <section className="panel"><div className="panel-head"><div><h2>{String(journal.journal_number || "Draft journal")}</h2><p>{String(journal.status)} · {String(journal.journal_date)} · {String(journal.reference || "No reference")}</p></div>{journal.status === "draft" && <><Link className="button" href={`/accounting/journals/${id}/edit`}>Edit</Link> <button className="button" onClick={() => void action("post_journal_entry")}>Post</button> <button className="text-button" onClick={() => { if (window.confirm("Delete this draft journal?")) void action("delete_journal_draft"); }}>Delete</button></>}{journal.status === "posted" && <button className="button" onClick={() => void action("reverse_journal_entry")}>Reverse</button>}</div><p>{String(journal.description || "")}</p>{related ? <p>Related journal: <Link className="text-button" href={`/accounting/journals/${String(related)}`}>View linked journal</Link></p> : null}<table className="data-table"><thead><tr><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{lines.map((line) => { const account = line.accounts as Row; return <tr key={String(line.id)}><td>{String(account?.code || "")} · {String(account?.name || "")}</td><td>{String(line.description || "")}</td><td>{money(line.debit_amount)}</td><td>{money(line.credit_amount)}</td></tr>; })}</tbody></table>{notice && <p className="form-message">{notice}</p>}</section>;
}

export function MultiLineJournal() { return <JournalForm />; }
export function EditJournal({ id }: { id: string }) { return <JournalForm journalId={id} />; }

function JournalForm({ journalId }: { journalId?: string }) {
  const { organization } = useOrganizationContext();
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [branches, setBranches] = useState<Row[]>([]);
  const [journalDate, setJournalDate] = useState(new Date().toISOString().slice(0, 10));
  const [branch, setBranch] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const db = createClient();
    void db.from("accounts").select("id,code,name").eq("organization_id", organization.id).eq("is_active", true).eq("allow_manual_posting", true).order("code").then(({ data }) => setAccounts((data ?? []) as Row[]));
    void db.from("branches").select("id,name").eq("organization_id", organization.id).eq("is_active", true).order("name").then(({ data }) => setBranches((data ?? []) as Row[]));
    if (journalId) void db.from("journal_entries").select("journal_date,branch_id,reference,description,journal_lines(account_id,description,debit_amount,credit_amount)").eq("organization_id", organization.id).eq("id", journalId).eq("status", "draft").single().then(({ data, error }) => {
      if (error || !data) { setNotice("This journal is no longer an editable draft."); return; }
      setJournalDate(data.journal_date); setBranch(data.branch_id || ""); setReference(data.reference || ""); setDescription(data.description || "");
      setLines((data.journal_lines || []).map((line) => ({ account_id: line.account_id, description: line.description || "", debit: String(line.debit_amount || ""), credit: String(line.credit_amount || "") })) || [blankLine(), blankLine()]);
    });
  }, [journalId, organization.id]);
  const debit = useMemo(() => lines.reduce((total, line) => total + Number(line.debit || 0), 0), [lines]);
  const credit = useMemo(() => lines.reduce((total, line) => total + Number(line.credit || 0), 0), [lines]);
  const changeLine = (index: number, key: keyof DraftLine, value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  const save = async (post: boolean) => {
    if (lines.length < 2) { setNotice("A journal needs at least two lines."); return; }
    const db = createClient();
    const payload = { p_organization_id: organization.id, p_journal_date: journalDate, p_branch_id: branch || null, p_reference: reference, p_description: description, p_lines: lines.map((line) => ({ ...line, debit: line.debit || "0", credit: line.credit || "0" })) };
    const draft = journalId ? await db.rpc("update_journal_draft", { ...payload, p_journal_id: journalId }) : await db.rpc("create_journal_draft", payload);
    if (draft.error) { setNotice(draft.error.message); return; }
    const savedId = journalId || draft.data;
    if (!post) { setNotice("Draft saved. Refresh-safe edits are persisted."); return; }
    const result = await db.rpc("post_journal_entry", { p_organization_id: organization.id, p_journal_id: savedId });
    setNotice(result.error ? result.error.message : "Journal posted.");
  };
  return <section className="panel form-panel"><h2>{journalId ? "Edit Draft Journal" : "New Journal"}</h2><div className="form-grid"><label>Date<input type="date" value={journalDate} onChange={(event) => setJournalDate(event.target.value)} /></label><label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">No branch</option>{branches.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></label><label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} required /></label></div><table className="data-table journal-lines-table"><thead><tr><th>Account</th><th>Line description</th><th>Debit</th><th>Credit</th><th /></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td data-label="Account"><select value={line.account_id} onChange={(event) => changeLine(index, "account_id", event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{String(account.code)} · {String(account.name)}</option>)}</select></td><td data-label="Description"><input value={line.description} onChange={(event) => changeLine(index, "description", event.target.value)} /></td><td data-label="Debit"><input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => changeLine(index, "debit", event.target.value)} /></td><td data-label="Credit"><input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => changeLine(index, "credit", event.target.value)} /></td><td data-label="Actions"><button className="text-button" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></td></tr>)}</tbody></table><button className="text-button" onClick={() => setLines((current) => [...current, blankLine()])}>+ Add line</button><p>Total Debit {money(debit)} · Total Credit {money(credit)} · Difference {money(debit - credit)}</p><button className="button" onClick={() => void save(false)}>Save Draft</button> <button className="button" onClick={() => void save(true)}>Post</button>{notice && <p className="form-message">{notice}</p>}</section>;
}
