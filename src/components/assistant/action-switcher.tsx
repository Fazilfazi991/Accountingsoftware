"use client";

import { actionRegistry, type ActionId } from "@/lib/assistant/action-registry";
import styles from "./guided-invoice.module.css";

const active: ActionId[] = ["create_invoice_draft", "create_quotation_draft", "create_customer"];
export function ActionSwitcher({ current, allowed, disabled = false, onRequest }: {
  current: ActionId; allowed: Record<string, boolean>; disabled?: boolean;
  onRequest: (target: ActionId) => void;
}) {
  return <nav className={styles.switcher} aria-label="Guided actions">
    {active.map((id) => <button key={id} type="button" aria-current={id === current ? "step" : undefined}
      disabled={disabled || id === current || !allowed[id]} onClick={() => onRequest(id)}>
      {actionRegistry[id].label}</button>)}
  </nav>;
}
