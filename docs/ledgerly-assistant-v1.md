# Ledgerly Assistant V1: financial source map and integration contract

Assistant lives only at `/assistant` and `/api/assistant`. It is read-only. No migration, RLS, posting, or VAT-engine change is required. Every request resolves the active organization and branch from the signed-in membership/session; planner output cannot contain either ID. The existing RPCs use authenticated membership checks. Direct document search uses the cookie-scoped user client, explicit organization/branch filters, RLS, and posted status.

| Question / tool | Authoritative source | Status / formula | Reused logic |
| --- | --- | --- | --- |
| Cash position | `get_live_dashboard` | Posted/reversed journal cash debit−credit plus active bank-account journal balances; never invoice totals | Dashboard RPC |
| Receivables and overdue customers | `get_open_item_report(receivable,open,today,branch)` | Open/partial items' **remaining** balances; overdue when due date precedes today; grouped by party; cap 2,000 source items | Existing AR open-item report |
| Payables and bills due | `get_open_item_report(payable,open,today,branch)` | Open/partial remaining balances; due-date range, optional minimum; overdue and future separated | Existing AP open-item report |
| Sales summary | `get_profit_and_loss(from,to,branch)` | Posted/reversed journal income account groups (`revenue`), not draft invoices or cash collections; label as ledger revenue | P&L RPC |
| Expense summary | `get_profit_and_loss(from,to,branch)` | Posted/reversed non-COGS expense account groups (`expenses`), labelled operating expenses rather than cash spend | P&L RPC |
| Profit | `get_profit_and_loss(from,to,branch)` | Revenue − COGS − operating expenses = netProfit; no invoice−expense shortcut | P&L RPC |
| VAT estimate | `get_vat_report(from,to,branch)` | Existing net output VAT − net input VAT; estimate only, pending documents/reconciliation may change amount | UAE VAT RPC |
| Transaction search | Posted invoice, bill, paid expense, customer receipt and supplier payment tables | Scoped by organization/branch, posted status, date, amount ±0.005, type; at most 200 scanned per type, 20 returned; truncation refuses to claim completeness | Existing document sources |
| Cash change | `get_cash_flow_statement(from,to,branch)` | Existing opening + operating + investing + financing + unclassified = closing; refuses when reconciliation difference exceeds 0.01 | Direct cash-flow RPC |
| Business attention/brief | Dashboard + AR/AP open-item reports; brief also P&L | Cash/bank, overdue AR/AP, bills due in seven days; brief adds period ledger revenue and operating expenses | Above approved reports |

Numbers are rendered directly from structured report data. The optional compatible AI provider selects **one** whitelisted read-only tool and parameters; it receives only a short question and at most four sanitized prior question/tool/argument references, never financial rows. A deterministic planner handles unavailable or failing providers. The server validates each selected tool and its exact arguments with strict schemas, bounds a request to 500 characters and eight useful turns, limits result windows and provider time to six seconds. Business names and references are output as text data; they are never concatenated into planner instructions. Deep links are built from an approved route list and checked UUIDs, not model output.

Trust statuses are `verified`, `estimate`, and `insufficient_data`. `verified` means derived from currently recorded posted/reversed ledger or posted open-item documents, not an audit certification. VAT is always `estimate`. Failed or over-limit reports return no fabricated number. Historical open-item balances are not reconstructed for last-month receivable follow-ups, because the current open-item RPC exposes today's remaining amount; that capability is deferred rather than misrepresented. Transaction search deliberately requests a narrower filter if a capped document window is full. Search supports a bounded scan, not an unrestricted full-text index.

## Future integration (not implemented)

- Agent 1 navigation can add a simple `/assistant` entry or button after branch integration; this branch has no sidebar edits.
- Agent 2 Today can navigate to `/assistant` with a contextual question, with trusted route/entity context validated server-side in a later version. Today logic is not imported.
- A future contextual “Ask why” can supply a route/entity reference from authenticated application code. Do not trust a browser-provided organization or arbitrary report identifier.
- A global desktop panel can reuse the chat component/response contract with a panel layout; mobile should continue to use `/assistant` as a full-screen route.
- Future draft/write approvals must live in a separate safety tier and separate audit/confirmation workflow, never inside the read-only V1 registry.

## QA prerequisites

The isolated ignored `.env.local` points only at QA and has an anonymous key, but does not contain QA user credentials or an AI credential. Unit/build checks can run; authenticated reconciliation of Assistant amounts against AR/AP, P&L, bank, VAT, and transaction screens requires a permitted QA user session. Do not use Production or service-role keys as a shortcut. A real-provider smoke test additionally needs server-side `LEDGERLY_AI_PROVIDER=openai-compatible`, `LEDGERLY_AI_MODEL`, `LEDGERLY_AI_BASE_URL`, and `LEDGERLY_AI_API_KEY`.
