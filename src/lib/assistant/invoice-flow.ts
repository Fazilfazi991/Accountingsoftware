import type { BusinessDocumentLine } from "@/lib/business-document-lines";

export type InvoiceStage = "idle" | "customer" | "items" | "details" | "preview" | "saving" | "checking" | "success" | "uncertain";
export type GuidedInvoiceState = {
  stage: InvoiceStage;
  customerId: string;
  lines: BusinessDocumentLine[];
  documentDate: string;
  dueDate: string;
  reference: string;
  notes: string;
  requestId: string;
  savedId: string;
  savedNumber: string;
  recovered: boolean;
  error: string;
};
export type InvoiceEvent =
  | { type: "begin"; today: string; requestId: string; firstLine?: BusinessDocumentLine; initialCustomerId?: string }
  | { type: "customer"; id: string }
  | { type: "lines"; lines: BusinessDocumentLine[] }
  | { type: "details"; fields: Partial<Pick<GuidedInvoiceState, "documentDate" | "dueDate" | "reference" | "notes">> }
  | { type: "next"; valid: boolean }
  | { type: "edit"; stage: "customer" | "items" | "details" }
  | { type: "confirm" }
  | { type: "saved"; id: string; number: string }
  | { type: "checking" }
  | { type: "recovered"; id: string; label: string }
  | { type: "failed"; error: string }
  | { type: "uncertain"; error: string }
  | { type: "issue"; error: string }
  | { type: "cancel" };

export const emptyInvoiceState: GuidedInvoiceState = {
  stage: "idle", customerId: "", lines: [], documentDate: "", dueDate: "", reference: "", notes: "",
  requestId: "", savedId: "", savedNumber: "", recovered: false, error: "",
};

export function guidedInvoiceReducer(state: GuidedInvoiceState, event: InvoiceEvent): GuidedInvoiceState {
  switch (event.type) {
    case "begin": return { ...emptyInvoiceState, stage: "customer", customerId: event.initialCustomerId || "", documentDate: event.today,
      dueDate: event.today, requestId: event.requestId, lines: event.firstLine ? [event.firstLine] : [] };
    case "cancel": return emptyInvoiceState;
    case "customer": return ["customer", "items", "details", "preview"].includes(state.stage)
      ? { ...state, customerId: event.id, error: "" } : state;
    case "lines": return ["customer", "items", "details", "preview"].includes(state.stage)
      ? { ...state, lines: event.lines, error: "" } : state;
    case "details": return ["details", "preview"].includes(state.stage)
      ? { ...state, ...event.fields, error: "" } : state;
    case "next": {
      if (!event.valid) return state;
      const next = { customer: "items", items: "details", details: "preview" } as const;
      return state.stage in next ? { ...state, stage: next[state.stage as keyof typeof next], error: "" } : state;
    }
    case "edit": return ["customer", "items", "details", "preview"].includes(state.stage)
      ? { ...state, stage: event.stage, error: "" } : state;
    case "confirm": return ["preview", "uncertain"].includes(state.stage) ? { ...state, stage: "saving", error: "" } : state;
    case "saved": return state.stage === "saving" ? { ...state, stage: "success", savedId: event.id,
      savedNumber: event.number, error: "" } : state;
    case "checking": return state.stage === "saving" ? { ...state, stage: "checking" } : state;
    case "recovered": return state.stage === "checking" ? { ...state, stage: "success", savedId: event.id,
      savedNumber: event.label, recovered: true, error: "" } : state;
    case "failed": return state.stage === "saving" ? { ...state, stage: "preview", error: event.error } : state;
    case "uncertain": return ["saving", "checking"].includes(state.stage) ? { ...state, stage: "uncertain", error: event.error } : state;
    case "issue": return ["customer", "items", "details", "preview"].includes(state.stage)
      ? { ...state, error: event.error } : state;
  }
}
