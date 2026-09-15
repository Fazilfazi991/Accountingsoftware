import type { ActionId } from "./action-registry";

const slot = (action: ActionId, branchId: string) => `ledgerly:assistant-write:v1:${action}:${branchId}`;

/** Session storage survives a reload but does not expose business payload. */
export function acquireAssistantRequestKey(action: ActionId, branchId: string): string {
  const name = slot(action, branchId);
  try {
    const existing = sessionStorage.getItem(name);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing))
      return existing;
  } catch { /* The in-memory key still protects retry in this mounted workflow. */ }
  const key = crypto.randomUUID();
  try { sessionStorage.setItem(name, key); } catch { /* Storage may be disabled. */ }
  return key;
}

export function rotateAssistantRequestKey(action: ActionId, branchId: string): string {
  const key = crypto.randomUUID();
  try { sessionStorage.setItem(slot(action, branchId), key); } catch { /* Storage may be disabled. */ }
  return key;
}

export function clearAssistantRequestKey(action: ActionId, branchId: string): void {
  try { sessionStorage.removeItem(slot(action, branchId)); } catch { /* Storage may be disabled. */ }
}
