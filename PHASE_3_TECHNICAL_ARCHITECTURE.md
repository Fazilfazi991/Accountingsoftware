# UAE Accounting SaaS — Phase 3 technical architecture and build preparation

**Status:** implementation-ready blueprint only. No repository, Supabase project, migrations, UI, business logic, or external account changes were made.  
**Canonical product source:** `PHASE_2_PRODUCT_SPECIFICATION.md`.  
**Design principle:** all commercial flows are application-friendly but ledger-safe: server-authorized, database-atomic, immutable after posting, and tenant-isolated by default.

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js App Router + React + TypeScript | Server Components for read paths; Server Actions/Route Handlers for authenticated commands; strong Vercel fit. Default Node.js runtime. |
| UI | Tailwind CSS, shadcn/ui primitives, Lucide, TanStack Table | Accessible consistent UI, no proprietary business logic in components, capable data tables. |
| Auth/data | Supabase Auth, PostgreSQL, `@supabase/ssr`, `@supabase/supabase-js` | Managed auth/Postgres/storage with RLS. |
| Validation/forms | Zod + React Hook Form | Shared runtime validation and ergonomic drafts; server validation remains mandatory. |
| Money/dates | PostgreSQL `numeric`; decimal.js-light (or equivalent) for non-authoritative UI previews; date-fns + date-fns-tz | Avoid JS binary float; explicit tenant timezone and ISO dates. |
| Documents | React-pdf for V1 server-rendered deterministic PDFs; CSV via a small library/native streaming; SheetJS only if XLSX is required | Controlled server output based on immutable snapshots. |
| Tests | Vitest, Playwright, pgTAP/Supabase DB tests | Unit, E2E, and database/RLS/posting invariant coverage. |
| Observability | Vercel logs/analytics plus Sentry | Correlation IDs, server errors and release visibility; redact financial payloads. |
| Hosting | Vercel + separate Supabase projects + GitHub/Git | Preview/staging/production separation and migration discipline. |

Pin versions and commit the lockfile. Do not add an ORM in V1: accounting-critical SQL/RPC contracts should be explicit. A query builder may be evaluated later, but it must not hide transaction/RLS behavior.

## 2. Application architecture

```text
src/
  app/                         # route groups, layouts, server pages, route handlers
    (marketing)/
    (auth)/
    (app)/[orgSlug]/            # active organization URL boundary
  components/                   # shared, presentation-only components
  features/<module>/
    ui/                         # module screens/forms/tables
    application/                # use cases, command DTOs, query services
    domain/                     # types, state transitions, pure policies
    infrastructure/             # Supabase repositories/adapters
  server/
    auth/ authorization/ db/ posting/ reporting/ storage/ observability/
  lib/                          # decimal, dates, result/errors, constants
  types/                        # generated DB + shared API types
```

React components only collect validated input/render data. Server Actions are thin transport adapters; Route Handlers are only for webhooks, exports and external APIs. `server/posting` calls database RPCs; no feature module directly inserts `journal_lines` or `inventory_movements`. Cross-feature dependencies point inward to stable contracts: sales/purchases/expenses → posting; posting → accounting/tax/inventory contracts; reports only query sources. No feature imports another feature’s UI.

## 3. Domain modules

| Module | Responsibility / core entities | Services, operations and UI | Dependencies |
|---|---|---|---|
| auth | session/profile | sign-in, callback, session/context guards | Supabase Auth |
| organizations | org, branch, settings, periods, sequences | setup, switch org, branch settings | permissions, audit |
| users | memberships, roles, permissions, invitations | invite, grants, scopes, user screens | organizations, audit |
| accounting | accounts, journals, lines, opening balances | COA, period control, GL/TB queries | org, tax, posting |
| sales | customers, quotes, invoices, credit notes | draft CRUD, post/reverse commands, sales screens | products, tax, posting, payments |
| purchases | suppliers, bills, debit notes | draft/post/reverse | inventory, tax, posting, payments |
| products | items/categories/units/warehouse policies | catalog and archive screens | organizations |
| inventory | movements/balances | stock availability, adjustment/transfer posting | products, accounting/posting |
| banking/payments | accounts, receipts/payments/transfers/allocations | post, allocate, reconciliation | accounting, sales/purchases |
| expenses | expenses/categories | expense post | tax, banking, posting |
| tax | codes/rate versions/periods/transactions | calculation, VAT queries/config | accounting, posting |
| reports | journal/open-item/stock/tax derived reports | server-side report queries/export | all read contracts |
| audit | audit events/entity revisions | append-only event writer/viewer | all command modules |

## 4. Environments and release flow

Use separate Supabase projects/databases for local, staging and production; separate Vercel projects or production/staging environments with distinct environment variables. Local uses Supabase CLI containers and synthetic seed data. Staging mirrors schema/RLS with masked/synthetic data only. Production secrets exist only in Vercel/Supabase protected settings; `service_role` never has a `NEXT_PUBLIC_` name or browser path.

Flow: `feature branch → CI (lint/type/unit/DB/RLS) → preview → staging migration + integration/E2E QA → reviewed main → production migration → deployment → smoke/reconciliation checks`. All schema/RLS/functions/grants live in committed SQL migrations. Never use dashboard-only schema changes as normal practice; never rewrite an applied migration. Backup before material production migrations and verify the migration ledger after deployment.

## 5. PostgreSQL schema blueprint

Every business table has `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at`, and appropriate created/updated membership IDs unless immutability makes updates unavailable. Tenant scope is `O` organization, `B` mandatory branch, `O/B` optional branch, `P` platform.

| Table | Purpose / important columns | FKs | Scope / constraints |
|---|---|---|---|
| organizations | legal name, slug, base_currency, timezone, status | plan optional | P; unique slug; base AED V1 |
| plans, subscriptions, feature_entitlements | commercial plan, status/dates, feature key/limit | org/plan | P; unique org subscription/feature period policy |
| profiles | auth user display details | `auth.users` | user-owned; id = auth uid |
| organization_memberships | user/org status, default branch | profiles, organizations | O; unique(org,user), active status |
| roles, permissions, membership_roles, role_permissions | templates/custom grants/string keys | org nullable for templates | O; unique permission key, unique mappings |
| membership_branch_scopes, membership_warehouse_scopes, invitations | scopes/invite token hash/expiry | membership/branch/warehouse | O; no raw invite token |
| branches, warehouses, organization_settings | operational/legal scope, settings JSON version | organization/branch | O/B; unique name per scope |
| fiscal_years, accounting_periods, document_sequences | dates/lock state; type/prefix/next number | org/branch optional/year | O/B; non-overlap periods; unique sequence scope |
| currencies, exchange_rates | ISO code/precision, date rate | org optional/currency | P/O; unique code/date pair |
| account_groups, accounts | hierarchy/class/type/system flags/control mapping | org/group | O; unique code; archive not delete after use |
| journals, journal_lines | immutable source journal/header lines | org/branch/accounts/source refs | O/B; unique active source; debit/credit checks |
| opening_balance_batches, opening_balance_lines | controlled initial position | org/account/period | O; posted via journal only |
| customers, suppliers | legal/display/contacts/TRN/defaults/status | org/control account | O; normalized duplicate warning indexes |
| quotations, quotation_lines | nonfinancial sales proposal | org/branch/customer/item | O/B; lifecycle/conversion quantities |
| sales_invoices, sales_invoice_lines, sales_credit_notes, credit_note_lines | posted snapshots/totals/tax | org/branch/customer/item/source invoice | O/B; unique number; immutable after post |
| purchase_bills, purchase_bill_lines, purchase_debit_notes, purchase_debit_note_lines | AP/stock/expense documents | org/branch/supplier/item | O/B; supplier reference uniqueness policy |
| categories, units, items, item_warehouse_policies | catalog/tracking/mappings/reorder | org/item/warehouse/accounts | O/B; item archive only |
| inventory_movements, inventory_balances | append-only event / derived cached balance | org/branch/warehouse/item/source/reversal | O/B; unique source-line movement semantics |
| cash_bank_accounts, receipts, payments, transfers, allocations | GL-mapped money movement/open-item links | org/branch/account/customer/supplier/doc | O/B; allocation nonnegative/capped |
| tax_codes, tax_rate_versions, tax_periods, tax_transactions | jurisdiction/rate effective dates/snapshots | org/accounts/tax code | O; rate version non-overlap |
| audit_events, entity_revisions, posting_runs | immutable actor/action/diff/correlation/idempotency | org/membership/entity | O/P; append-only, unique idempotency where relevant |

Add sales orders/delivery notes/purchase orders/goods receipts in V1.1 as separate header/line families. Do not use one giant transaction table: sales and purchases share reusable value-object/snapshot patterns, but retain distinct commercial semantics and constraints.

## 6. IDs, money and currency

Use UUID primary keys (`gen_random_uuid()`); human document numbers are separately generated sequences, e.g. `INV-2026-00001`. A sequence row is atomically locked/incremented inside posting/creation RPC (`SELECT … FOR UPDATE`); its unique index includes `(organization_id, document_type, fiscal_year_id, branch_id nulls-not-distinct, document_number)`. Posted documents retain their assigned number forever.

Use PostgreSQL `numeric(20,6)` for stored monetary amounts, quantities, unit costs and exchange rates; `numeric(9,6)` for tax/percentages. Display AED to two decimals, while preserve storage precision and tax/rounding trace. Never use JavaScript `number` for authoritative totals; UI previews use decimal.js-light and server/DB recalculates. Monetary rows retain `document_currency_code`, `exchange_rate`, document amounts and base AED amounts. V1 simply has rate `1`; the columns avoid later rewrite.

## 7. Tenancy, RLS and permissions

`organization_id` is mandatory on all tenant-owned entities, including journals/lines, document lines, tax, audit, reports and storage metadata. `branch_id` is mandatory for operational documents, journals, cash/bank and warehouse stock; optional for company-wide masters/settings/accounts/tax. Active organization is explicit in route and server command context, verified against membership—not trusted from cookies/form values.

RLS is enabled on every exposed-schema table, grants are explicitly revoked/regranted, and each operation has separate `SELECT/INSERT/UPDATE/DELETE` policies. Base predicate: active membership for `(auth.uid(), row.organization_id)` plus branch/warehouse-scope check. Index all policy predicate columns. RLS permits read/draft-safe updates only; privileged financial commands go through RPC. Never base authorization on editable user metadata; never expose service role. Views either live in a private schema or use `security_invoker = true`. These controls follow Supabase’s guidance that RLS and grants are separate, each operation needs policies, and policies should be tested. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

Permissions use normalized rows with immutable string keys (`sales.invoice.post`, `accounting.journal.post`, `banking.reconcile`, etc.), role mappings and optional membership overrides. Server `authorize(context, key, {branchId, warehouseId})` confirms membership, entitlement and scopes before command/RPC invocation. RLS ensures row isolation; the permission engine enforces business action authorization. Platform admins receive no tenant access by default; time-boxed support grant is explicit/read-only/audited.

## 8. Posting, journals, immutability and periods

Use a **combination**: TypeScript domain services validate command intent and construct a posting plan/preview; narrowly exposed PostgreSQL `SECURITY DEFINER` RPCs execute the authoritative transaction. Each RPC sets a safe search path, checks `auth.uid()`/membership/permission itself, limits execute grants to `authenticated`, and is never a generic bypass. It locks the draft/source, period, sequence and affected stock/balance rows; recalculates server-side; inserts journal/movements; changes status; writes audit event; commits or rolls back together.

```text
validated command → authorization → posting preview → RPC database transaction
→ lock document/idempotency/period → derive rules → journal + lines
→ tax transactions + inventory movements/balance cache → lock document
→ audit/posting run → commit
```

`journals`: org/branch, journal number/type, source type/id, document/accounting dates, currency/rate, `posted`, original/reversal references, posted actor/time. `journal_lines`: account, debit/credit/base debit/base credit, counterparty/tax/source line/description. Constraints: nonnegative values; exactly one of debit/credit is positive; base equivalent likewise; account belongs to organization. A deferred trigger (or RPC final validation) asserts aggregate debit = credit before commit. Unique partial index permits one non-reversal active journal per `(organization_id, source_type, source_id)`.

Drafts can update through scoped policies. Posted financial/stock documents deny normal UPDATE/DELETE via RLS plus database trigger; append-only journal/movement policies deny update/delete. Reversal creates a linked opposite journal (swap debit/credit) and opposite stock movement where appropriate; it preserves original/source/reason/actor/period. Credit/debit notes are business documents, not rewrites. Periods are `OPEN`, `SOFT_LOCKED`, `HARD_LOCKED`: ordinary posting only OPEN; soft override only designated accountants with reason/audit; hard lock cannot be altered by tenant posting and requires governed platform/accounting procedure.

Idempotency: command includes UUID idempotency key; `posting_runs` unique on `(organization_id, operation, idempotency_key)`. Source document has guarded state and unique source journal. A retry returns the prior completed result; double click cannot double-post.

## 9. Core technical flows

**Sales invoice:** draft header/lines/snapshots → server validation/optional approval → `post_sales_invoice` locks draft → assigns number → posts AR/revenue/output VAT and, for tracked direct sale, COGS/inventory → creates receivable open item → audit. Delivery-linked invoice skips duplicate stock effect. Credit note validates source/remaining quantities, posts contra revenue/VAT/AR and stock only on returned goods. Quotation never journals; conversion quantities are locked/derived.

**Purchase bill:** draft → `post_purchase_bill` validates account/tax/item/period → Dr inventory or expense, Dr input VAT, Cr AP; creates payable open item and receipt stock event only where no GRN already created it. Debit note/purchase return is linked and opposite. Customer receipt/supplier payment posts cash/bank against AR/AP; `allocate_*` locks payment and target open items, creates allocations only, and derives outstanding. Transfers post cash/bank-to-cash/bank; stock transfer posts paired movements without P&L.

Inventory is append-only (`source_type/id/line`, type, delta, cost/value, date, reversal). `inventory_balances` is an optional transactional cache keyed by org/warehouse/item; it is rebuilt/verifiable from movements, never directly edited. Weighted-average perpetual cost is the V1 candidate pending accountant approval: receiving recalculates average under item/warehouse row lock; issuing snapshots current applied average to movement/COGS; a later policy change requires a versioned valuation transition, never recomputes history.

Tax codes/rate versions have jurisdiction/effective dates and GL mapping. Posting stores line snapshots. Exclusive tax: compute net line, discount, taxable base, tax then total; inclusive tax: derive taxable base from gross/(1+rate), apply configured rounding, retain rounding delta. No `5%` constants outside seed/config.

## 10. Snapshots, PDFs, reports and dashboard

Posted documents store immutable JSONB snapshots (versioned schema) of organization legal/branding/TRN, customer/supplier legal/contact/address, billing/shipping, item description/SKU/unit, tax code/rate and terms. Normalized master FKs remain for reporting; snapshots render historical PDF truth.

Render PDFs server-side with React-pdf from authorized immutable document/query DTOs. Store generated documents under private object storage when retention requires it; generation remains reproducible. Template configuration includes logo, legal/TRN/bank details, footer/terms and future bilingual strings—never client-supplied HTML.

Financial reports derive from posted `journal_lines` and accounts: GL/TB/P&L/BS. AR/AP derive from immutable open items + allocations/credits; inventory from movements/balances; VAT from posted tax transactions/snapshots. Use private SQL views/functions with security invoker or server execution, never editable totals. Dashboard begins with a small parallel set of indexed server queries and short request cache; introduce materialized views/aggregate tables only after measured need, refresh asynchronously and reconcile them against sources.

## 11. Concurrency, errors and database transactions

All posting, reversal, allocation, stock transfer/adjustment, sequence generation, period locking and balance-cache updates occur in a single PostgreSQL transaction via RPC. Lock document rows, relevant period/sequence and item-warehouse/open-item rows in consistent order. Use optimistic `draft_version` on editable drafts; stale write returns conflict rather than overwriting. Allocation locks targets; stock issue locks balance cache; sequence atomicity prevents collisions.

Expose user-safe domain errors, e.g. “Cannot post invoice: August 2026 is locked”, “Invoice has already been posted”, or “Cannot deliver 8 units: only 5 available in Main Warehouse.” Map database domain codes to messages. Unexpected errors receive correlation ID, structured server log and generic user message; never leak SQL, tenant IDs, stack traces or secrets.

## 12. RPC, migrations, seed, storage and imports

High-risk RPCs: `post_sales_invoice`, `reverse_sales_invoice`, `post_purchase_bill`, `reverse_purchase_bill`, `post_customer_receipt`, `post_supplier_payment`, `allocate_receipt`, `allocate_payment`, `post_stock_adjustment`, `post_stock_transfer`, `lock_accounting_period`, `post_opening_balance_batch`. Each accepts organization/document IDs + idempotency key, validates state/permission/scope/period/tax/accounts, and emits one audit/posting result.

Migration convention: `YYYYMMDDHHMMSS_descriptive_name.sql`; one logical change per migration including tables, RLS, grants, functions, indexes and tests. Validate locally, then staging, back up/approve production, apply once, verify `supabase_migrations` and run smoke/reconciliation checks. Forward-only corrective migrations; no rewriting applied history.

Development/staging seed: fictional UAE organization/COA/tax codes/branches/warehouses/customers/suppliers/items/documents/payments and expected journals. Production never receives fixture transactions. A demo tenant is separate fake data, restricted/resettable and has no real customer links. Private storage paths: `org/{organization_id}/company/`, `.../documents/{document_id}/`, `.../imports/{job_id}/`, `.../exports/{export_id}/`; metadata carries org ID; signed URLs are short-lived after authorization.

Import pipeline: `upload → virus/type/size check → parse → map → validate → preview/errors → explicit commit`. Imports write staging rows, never direct financial tables; opening balances/invoices only commit via controlled posting RPC. Log mapping/version/actor and preserve error file safely.

## 13. Testing, security, observability and performance

Unit: decimal/tax/number/lifecycle/allocation policies. Database pgTAP: constraints, grants/RLS allow+deny tests, RPC atomics, locks and immutability. Integration: invoice→journal/AR/COGS, bill→AP/input VAT, payment→allocation, inventory→GL. Playwright: organization setup, customer, invoice, payment, report, reversal. Critical fixtures assert expected journal lines.

Permanent reconciliation invariants: total debit = credit; AR control = customer open items; AP control = supplier open items; inventory GL = valuation where perpetual inventory applies; VAT report = VAT GL/tax transactions. Run in CI against fixture database and as production read-only monitoring checks.

Security: Auth cookie/session SSR validation; RLS + grants; server authorization; rate limits on auth/invites/exports; CSRF-aware framework defaults and origin checks for sensitive mutations; signed storage URLs; secrets in server environment only; no service role browser access; audit every privilege/support/financial action. Log structured event name/correlation/org (minimally), error class and timing—not raw documents, passwords, tokens or payment credentials. Monitor posting failures, RLS denial anomalies, migrations and health. Index `organization_id`, branch/warehouse, status, dates, source references, membership user/org, open-item/payment and report filter combinations; paginate server-side; avoid N+1 and broad selects; run large exports as controlled jobs. Use Supabase backups/PITR when plan permits, separate staging, documented restore drills and audited recovery procedure.

## 14. Technical batch roadmap

| Batch | Scope, tables/RLS/RPC/UI/tests | Explicit exclusion |
|---|---|---|
| 1 Foundation | App/auth/org/profile/membership/branch/audit basics; RLS; app shell; RLS/E2E isolation tests | Accounting, billing, financial data |
| 2 Setup/permissions | settings, periods, sequences, COA, roles/scopes; period/permission tests | posting |
| 3 Posting core | journals/lines/posting runs/RPC guardrails/opening balances; balance tests | sales UI |
| 4 Masters | customers/suppliers/items/categories/units/warehouses | stock/money posting |
| 5 Sales | quotes/invoices/credits, sales posting PDF | delivery/order |
| 6 Purchases/expenses | bills/debits/expenses/posting | GRN/PO |
| 7 Payments | cash/bank/receipts/payments/allocations/ageing | reconciliation |
| 8 Inventory/VAT | movements/balance/tax period/report preparation | serials/multicurrency |
| 9 Reports/dashboard | financial/operational/VAT reports, export, KPIs | costly aggregates until measured |
| 10 V1.1 | orders/deliveries/GRNs/transfers/reconciliation/approvals | verticals |
| 11 SaaS growth | subscription/entitlements/demo/support access | platform financial editing |

Every batch adds its migrations, indexes/grants/RLS policies, RPCs, routes/domain services, unit/DB/integration tests, acceptance fixtures and release notes. CI must be green before moving on; each batch has a staging acceptance run and reconciliation evidence where it posts finance.

## 15. Detailed Batch 1 plan

**Directories/files (planned):** `src/app/(auth)/sign-in/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/(app)/[orgSlug]/layout.tsx`, `src/app/(app)/[orgSlug]/page.tsx`, `src/components/app-shell/*`, `src/features/auth/*`, `src/features/organizations/*`, `src/server/supabase/{browser,server,middleware}.ts`, `src/server/auth/{require-user,require-membership}.ts`, `src/server/audit/write-event.ts`, `src/types/database.ts`, `supabase/migrations/*`, `supabase/seed.sql`, `supabase/tests/{foundation_rls,audit}.sql`, `tests/e2e/{auth,organization-isolation}.spec.ts`.

**Migrations/tables:** extensions/default timestamps; `profiles`; `organizations`; `organization_memberships`; `branches`; minimal `organization_settings`; `audit_events`; invitations if email delivery is in Batch 1. Add FK/indexes, organization/branch RLS, explicit grants, immutable-audit trigger/policy, `handle_new_user` profile trigger only after auth-flow review. Do not create COA or financial tables.

**Policies:** profile self-read/update limited safe fields; organization/membership/branch read through active membership; owner-only organization/branch write; authenticated insert checks org membership; audit client read restricted to authorized org role, no client update/delete; all cross-tenant and inactive-membership requests denied. Do not rely on `user_metadata`.

**Pages/components:** sign in/callback, onboarding create organization/first branch, organization switcher, protected shell, dashboard placeholder, unauthorized/not-found/error states, member list placeholder. **Server utilities:** typed server/browser clients, session refresh/proxy, active-org resolver, authorization context, correlation ID and append-only audit adapter. **Tests:** migration/RLS grants, member vs stranger vs inactive member, cross-org branch denial, auth redirect, active organization routing and audit event existence. **Acceptance:** a new user can sign in, create/select one organization and branch, access only own tenant route, a second tenant cannot read it through UI/API, protected routes redirect, and all actions are audited. **Exclusions:** roles UI beyond owner, invitations/email, subscription, accounting, storage uploads, all business modules.

## 16. Decision log

| Decision | Choice | Reason | Alternative | Change later? |
|---|---|---|---|---|
| Tables | Separate sales/purchase families | Strong semantics/constraints | generic document table | costly, avoid |
| IDs | UUID internal + human sequence | secure/global refs + friendly docs | integers only | UUID stable |
| Arithmetic | Postgres numeric | financial correctness | JS float | no |
| Tenancy | organization-per-row + RLS | scalable SaaS isolation | DB-per-tenant | possible later, costly |
| Posting | server plan + guarded RPC | atomic authoritative ledger | route-handler SQL | no for V1 |
| History | immutable post/reverse | auditability | editable posted docs | no |
| Inventory | perpetual weighted average candidate | V1 simplicity | FIFO/periodic | **accountant approval** |
| Tax | versioned codes/snapshots | preserves history | hardcoded rate | no |
| Snapshot | JSONB posted snapshot | historical render truth | master-only data | stable |
| PDFs | server React-pdf | deterministic/data-safe | client printing | can evolve |

## 17. Risk register and remaining approval gates

| Risk | Mitigation |
|---|---|
| Incorrect posting/VAT logic | Accountant-reviewed rules, fixtures, reconciliation invariants, staged release. |
| Tenant data leakage | RLS + grants + server authorization + deny tests + no browser service role. |
| Duplicate posts/sequence collision | idempotency, unique indexes, row locks, atomic RPC. |
| Stock/GL or AR/AP mismatch | append-only sources, posting transaction, nightly read-only reconciliation alerts. |
| Unsafe migrations | Git migrations, staging rehearsal, backups, forward-only repair. |
| Scope creep | V1 entitlement/scope gates; isolate vertical modules. |
| Broad support access | explicit time-bound read-only grant and audit. |

Approval gates before implementation: UAE accountant/FTA specialist validates VAT/tax-invoice/return rules; accountant approves COA, period-close/reversal, opening balance and stock-cost policy; product owner approves V1.1 exclusions, negative-stock and approval policies; security owner approves support/suspension/data-retention policy. This document then becomes the basis for the explicitly authorized Batch 1 implementation prompt.
