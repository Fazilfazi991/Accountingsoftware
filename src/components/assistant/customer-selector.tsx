"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./guided-invoice.module.css";

export type CustomerChoice = { id: string; name: string };

export function CustomerSelector({ customers, selectedId, onChoose, onAddCustomer }: {
  customers: readonly CustomerChoice[]; selectedId: string; onChoose: (id: string) => void;
  onAddCustomer?: () => void;
}) {
  const [search, setSearch] = useState("");
  const selected = customers.find((item) => item.id === selectedId);
  const filtered = customers.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <label className={styles.field}>Find customer<input type="search" value={search}
      onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer name" autoComplete="off" /></label>
    {selected && <div className={styles.selected}><span>Selected</span><strong>{selected.name}</strong>
      <button type="button" className={styles.textButton} onClick={() => onChoose("")}>Change</button></div>}
    <div className={styles.customerList} role="group" aria-label="Active customers">
      {filtered.slice(0, 30).map((item) => <button type="button" aria-pressed={item.id === selectedId}
        key={item.id} onClick={() => onChoose(item.id)}>{item.name}</button>)}
      {!filtered.length && <p>No matching active customers.</p>}
      {filtered.length > 30 && <p>Showing the first 30 matches. Refine your search.</p>}
    </div>
    <p className={styles.hint}>Need a new customer? {onAddCustomer && <button type="button" className={styles.inlineLink}
      onClick={onAddCustomer}>Add Customer here</button>}{onAddCustomer && " or "}
      <Link href="/sales/customers/new">use the full customer form</Link>.</p>
  </>;
}
