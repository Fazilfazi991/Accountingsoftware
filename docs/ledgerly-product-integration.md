# Ledgerly Product Integration V1

This branch starts at Production `ccd176c68ed42267491bd7bbd849414d98041b0e`, then ports four approved Today and five approved Assistant feature commits from their older base. The shared-shell changes are separate. No financial formula, RPC, migration, posting behavior, or database policy is modified.

## Routes and navigation

- `/` renders the same authenticated Today content as `/today`; no redirect is used, so the existing organization/session guard remains the entry boundary and there is no redirect loop. Old links to `/` still reach a valid Home.
- `/overview` renders the existing redesigned `LiveDashboard` in the current accounting workspace. The Overview rail item targets it directly.
- `/assistant` remains a standalone full-screen conversation workspace on mobile, inside the existing rail/topbar on desktop. The first-class Ask Ledgerly item links to it.
- The current Sales, Purchases, Inventory, Accounts, Reports, Masters, Settings flyouts and mobile drawer remain in place. Today Quick Create stays page-level; the current accounting topbar keeps its existing `+ New` action. No new global mobile `+` is introduced.
- Today links to Financial Overview. Contextual Today/Dashboard-to-Assistant handoffs are deferred until a trusted application-context contract exists; no URL query or browser-supplied internal context is accepted.

## Provider state

Without `LEDGERLY_AI_PROVIDER=openai-compatible` and server-side model, base URL and API key, Assistant uses its approved deterministic planner. Its UI labels this as guided, read-only financial questions and gives supported prompts, with explicit limitations on unsupported input. A provider can select only a validated read-only tool; financial answers still come from the same authenticated Ledgerly report sources. Real-provider smoke is pending configuration and is separate from deterministic financial grounding QA. No secrets are committed or sent to the browser.

## Deferred design debt

Today retains its approved hard-coded palette, which can be tokenized in a later scoped design-system pass. This integration only removes the accounting-page inset around Today/Assistant and aligns Assistant's font with the shell. Role-specific owner/accountant Home, a global mobile create button, contextual handoffs and a desktop side panel are V2 work.
