# UAE-first cloud accounting — Phase 2 product specification

**Status:** proposed requirements and architecture; no code, database, project, packages, or audited-account changes were made.  
**Primary evidence:** `PROFFIN_ERP_AUDIT.md`; UAE tax items remain subject to professional/regulatory verification.

## 1. Product vision and customers

Build a modern cloud accounting product for UAE SMEs: trading, service and retail businesses, their owners, accountants and operational staff. It must feel simple to a non-accountant while recording auditable double-entry accounting underneath. AED/UAE VAT is the first country pack; multi-currency, GCC jurisdictions and paid modules are deliberate extension points, not V1 clutter.

The product promise is: **create commercial documents quickly; post accounting accurately; always explain the financial effect; never silently rewrite history.**

## 2. Final module and menu map

Navigation is role- and entitlement-aware. A user sees only relevant top-level modules; all documents use shared screens with controlled behaviour, not code-specific copies.

```text
Home
├─ Dashboard
├─ Sales
│  ├─ Customers
│  ├─ Quotations
│  ├─ Sales Orders                 [V1.1]
│  ├─ Delivery Notes                [V1.1]
│  ├─ Invoices
│  ├─ Credit Notes
│  ├─ Customer Payments
│  └─ Receivables
├─ Purchases
│  ├─ Suppliers
│  ├─ Purchase Orders               [V1.1]
│  ├─ Goods Receipts                [V1.1]
│  ├─ Purchase Bills
│  ├─ Debit Notes / Purchase Returns
│  ├─ Supplier Payments
│  └─ Payables
├─ Products & Inventory
│  ├─ Products and Services
│  ├─ Categories and Units
│  ├─ Warehouses
│  ├─ Stock on Hand
│  ├─ Transfers / Adjustments       [V1.1]
│  └─ Stock Movement
├─ Banking
│  ├─ Cash and Bank Accounts
│  ├─ Transfers
│  └─ Reconciliation                [V1.1]
├─ Expenses
│  ├─ Expenses
│  ├─ Expense Categories
│  └─ Recurring Expenses             [V1.1]
├─ Accounting                       [accountant/admin role]
│  ├─ Chart of Accounts
│  ├─ Journal Entries
│  ├─ Opening Balances
│  ├─ Fiscal Periods
│  └─ General Ledger
├─ VAT
│  ├─ Tax Rates
│  ├─ VAT Transactions
│  ├─ VAT Summary
│  └─ VAT Return Preparation
├─ Reports
└─ Settings
   ├─ Organization / Branches
   ├─ Users and Roles
   ├─ Numbering and Templates
   ├─ Accounting and VAT
   ├─ Integrations                   [entitlement-controlled]
   └─ Subscription / Billing
```

Platform administration is a separately protected application, not a customer menu.

## 3. What not to reproduce from Proffin

| Legacy observation | Replacement in this product |
|---|---|
| `SAL7`, `SAL8`, `SALW`, `SAL`, POS and other near-duplicate sales screens | One Sales Invoice screen. Branch, warehouse, price list, payment method, POS mode and feature flags determine behaviour. |
| Transaction codes shown to users | Friendly document types; an internal immutable `document_type` is allowed but never becomes everyday navigation. |
| GST, e-way bill, state and Indian dispatch fields in UAE sales form | Country-pack fields. UAE default shows TRN, emirate/address and VAT fields only; other jurisdictions opt in. |
| Huge duplicated report trees | One Reports hub by business question; shared filters, saved views, drill-down and export. |
| Restaurant, garage, logistics, HR/payroll and CRM bundled into core | Separate optional modules with isolated entitlement, UI and data boundaries. |
| Month/year close and data-adjustment tools beside daily work | Accountant-only Settings/Accounting controls, permission-gated, guided and always audited. |
| One giant form with every conceivable field | Progressive sections: required details, line items, payment, delivery, notes/attachments, advanced fields. |
| Ambiguous Save behavior | Explicit **Save Draft**, **Approve** and **Post** actions with status badges and stated financial effects. |
| Generic “dummy” documents and inconsistent terminology | No production dummy flows. Use a dedicated demo tenant and consistent terminology. |

## 4. Scope classification

| Release | Included capabilities |
|---|---|
| **V1 — first commercial release** | Multi-tenant organization/branch/user security; company setup; AED base currency; UAE VAT configuration; COA; fiscal periods; opening balances; customers/suppliers; products/services/categories/units; quotations; invoices; purchase bills; credit/debit notes; expenses; cash/bank accounts; receipts/payments/transfers; allocation; automated journals; basic inventory for tracked products; sales/purchase/expense/AR/AP/GL/TB/P&L/BS/stock/VAT reports; PDF tax invoices; audit logs; roles; CSV export/import with validation. |
| **V1.1 — immediately after** | Sales/purchase orders, delivery notes/goods receipts, stock transfers/adjustments/reorder, bank reconciliation, recurring expenses, document templates, attachments, saved reports, email/WhatsApp delivery, approvals and multi-currency. |
| **V2 — advanced** | Serial/batch/expiry, price lists, POS, cheque lifecycle, cost centres/projects, budgets/cash flow, advanced inventory valuation, mobile capture, API/integrations, manufacturing/BOM. |
| **Optional paid modules** | POS/restaurant, payroll/HR, CRM, logistics/job costing, garage, ecommerce, construction/project accounting, country packs beyond UAE. |
| **Not required** | Separate branch/wholesale/simple invoice pages, India-specific default fields, destructive “quick fixes”, generic vertical modules, hidden accounting bypasses. |

## 5. Roles and permission design

Ship role templates, then allow admins to grant scoped permissions. Templates: Business Owner/Super Admin, Accountant, Sales User, Purchase User, Cashier, Inventory User and Viewer/Auditor.

Each grant has dimensions: **resource**, **action** (`view`, `create`, `edit_draft`, `approve`, `post`, `cancel`, `reverse`, `delete_draft`, `export`, `view_cost`, `view_profit`, `reconcile`, `manage_settings`), and **scope** (organization, branch, warehouse, own records). Permission evaluation is deny-by-default and must be enforced in the database/API, not only in UI.

Owners manage users/settings; Accountants post/close/VAT/report; Sales manages customers and sales drafts/invoices but does not see cost/profit by default; Purchase manages suppliers and bills; Cashiers can receive/pay to permitted cash/bank accounts; Inventory users manage items and stock movements; Viewers/Auditors have read-only access. Templates are starting points, never hard-coded limitations.

## 6. Transaction lifecycle and auditability

| Document | Lifecycle | Edit/cancel rule |
|---|---|---|
| Quotation / order | Draft → Sent/Approved → Accepted/Rejected/Expired → Converted/Cancelled | Draft editable; accepted source stays immutable except status/expiry; cancel has reason/audit. |
| Delivery note / goods receipt | Draft → Approved → Posted → Reversed | Posted creates stock event and is locked; correction is reversal/new document. |
| Invoice / purchase bill | Draft → Approved (optional) → Posted → Partially Paid/Paid → Cancelled or Credited/Reversed | Draft editable/deletable by permission; post locks commercial amounts and creates journal; no direct change after posting. |
| Receipt / payment / transfer | Draft → Approved (optional) → Posted → Allocated/Partially Allocated → Reversed | Posted money movement is immutable; allocation changes are separately audited and constrained. |
| Journal | Draft → Approved (optional) → Posted → Reversed | Posted journal is immutable; adjustment is a linked reversing or correcting journal. |
| Stock adjustment | Draft → Approved → Posted → Reversed | Requires reason, warehouse and control account; never edit quantities in place. |

`Cancelled` is for a document that has not produced final financial/stock effect, or invokes an equal/opposite reversal according to policy. `Reversed` creates linked opposite journal/stock events in an open period. A credit note is a business document tied to a posted invoice, with a VAT and receivable consequence—not an edit button. Every state change writes an audit event with reason and actor.

## 7. Accounting posting engine

Posting is a server-side atomic command. It validates organization/branch access, sequence, open period, document totals, tax snapshot and stock preconditions; it then stores the immutable document snapshot, balanced journal and (if applicable) inventory events together. No front-end calculation is authoritative.

| V1 source | Journal rule (tax-exclusive illustration) |
|---|---|
| Sales invoice — service | Dr Accounts Receivable; Cr Service Revenue; Cr Output VAT. |
| Sales invoice — stocked item | Above, plus Dr Cost of Sales; Cr Inventory for the applied cost. |
| Customer receipt | Dr Cash/Bank; Cr Accounts Receivable. Allocation does not re-post cash; it links open items. |
| Purchase bill — inventory | Dr Inventory; Dr Input VAT; Cr Accounts Payable. |
| Purchase bill — expense | Dr Expense; Dr Input VAT; Cr Accounts Payable. |
| Supplier payment | Dr Accounts Payable; Cr Cash/Bank. |
| Expense paid immediately | Dr Expense; Dr Input VAT; Cr Cash/Bank. |
| Credit note to customer | Dr Sales Returns/Revenue contra; Dr Output VAT; Cr Accounts Receivable; reverse COGS/inventory only where returned stock is received. |
| Supplier debit note/purchase return | Dr Accounts Payable; Cr Inventory/Expense; Cr Input VAT; stock effect only for returned tracked goods. |
| Bank/cash transfer | Dr destination cash/bank; Cr source cash/bank. |
| Opening balance | Opening-balance account/system equity balancing account until the accountant completes opening-balance setup. |
| Stock adjustment | Inventory debit/credit against configured inventory gain/loss account, with mandatory reason. |

Rules: debit equals credit in base currency; foreign-currency amounts retain document currency/rate; rounding is explicit and posted to configured rounding account only when necessary; every line retains source document and tax references; transaction date and accounting date are separate only with controlled policy; closed periods reject posting; reversal uses the original accounts/tax snapshot where legally appropriate.

## 8. Default UAE SME chart of accounts

Hierarchy uses `account_class` → `account_type` → account. System creates required control/tax/rounding accounts; tenants can add ordinary accounts and subaccounts but cannot change a system account’s financial type once used.

| Class | Core accounts |
|---|---|
| Assets | Cash on Hand, Bank Accounts, Accounts Receivable, Inventory, Prepayments, Input VAT Recoverable, Fixed Assets, Accumulated Depreciation (contra asset). |
| Liabilities | Accounts Payable, Output VAT Payable, VAT Net Payable/Receivable clearing, Loans, Accrued Expenses, Customer Advances. |
| Equity | Owner’s Capital, Retained Earnings, Current-Year Earnings, Opening Balance Equity (temporary/system controlled). |
| Income | Sales Revenue, Service Income, Other Income, Sales Returns/Discounts (contra income). |
| Cost of Sales | Cost of Goods Sold, Purchase Price Variance (future), Inventory Adjustment Loss (or grouped operating expense per policy). |
| Operating expenses | Rent, Salaries, Utilities, Marketing, Professional Fees, Delivery, Bank Charges, Depreciation, Other Expenses. |

System-controlled: AR/AP control, inventory, COGS, VAT accounts, rounding, retained earnings/opening balance equity and accounts referenced by posted rules. Editable: names/descriptions and permitted mappings before use. Never allow deletion of accounts referenced by journals; permit archive only.

## 9. Master-data models

### Customers and suppliers

Required customer fields: legal/display name, type (business/individual), default currency (AED), country and active status. Optional: TRN (validated when tax profile requires), contact person, phone, WhatsApp, email, billing/delivery addresses, emirate, payment terms, credit limit, notes and approved opening balance. Supplier mirrors this, with payable terms and purchase defaults. Duplicate detection uses normalized legal name + TRN/email/phone warnings, never silent merging. Customer/supplier records referenced by history are archived, not deleted.

### Products and services

`item_type = product | service`. Required: name, active status, sales/purchase tax treatment and revenue/expense mapping. Products additionally require SKU (auto or user-assigned), unit, tracking mode and inventory/COGS mapping when inventory is tracked. Optional: barcode, category, sales price, standard purchase cost, warehouse/reorder settings, description and image. V1 supports basic tracked/non-tracked product stock; serials, batches, expiry and variants are V2. An item used on a posted document cannot be deleted; it may be archived.

## 10. Sales and purchase architecture

Use **separate Sales and Purchase table families**, sharing small reusable primitives (money, addresses, tax snapshots, attachments, document numbering, lifecycle, open-item allocation). Separate families protect business meaning, approval rules, counterparties, journal mapping and reporting; a generic “transaction” table would over-generalize and recreate Proffin’s code problem.

Sales: quotation → optional order → optional delivery → invoice → receipt/allocation → credit note/refund. Purchases: optional PO → optional goods receipt → bill → supplier payment/allocation → debit note/purchase return. Conversion stores source document/line links and remaining quantities; it never mutates the source.

Invoice form sections: customer/date/number/currency; lines; pricing/tax; payment terms and due date; delivery (if enabled); notes/attachments; accounting preview (role-gated). Mandatory fields are kept small. Payment at invoice creation is represented by a separately visible receipt or embedded workflow that creates a distinct receipt document.

## 11. Inventory engine

Inventory is an append-only `inventory_movement` event stream, not an editable balance. Each event contains organization, branch, warehouse, item, quantity delta, unit/base-unit conversion, value/cost, source document/line, event date, posted timestamp and reversal link. Stock on hand is a derived balance, optionally materialized for performance.

Allowed origins: opening stock, goods receipt, sales delivery, direct invoice (only if no delivery is used), sales return, purchase return, adjustment and transfer-out/transfer-in. A direct invoice creates a sales stock event only when its lines have not already been delivered. Delivery creates the event and its later invoice only references fulfilled quantities. The system blocks double counting through source-line fulfilment quantities and an immutable `stock_effect_status`.

V1 policy: disallow negative stock by default, with an organization setting and explicit privileged override only after an accountant approves the policy. Cost method recommendation: perpetual weighted-average inventory for V1, fully documented and consistently applied; choose and validate it with an accountant before implementation. Transfers create paired linked movements and no P&L effect. Adjustments need reason, approver (if configured) and accounting counterpart.

## 12. Banking, payments and allocation

Cash and bank accounts map one-to-one to a GL account, with currency/branch and active status. Receipts, payments and transfers are separate immutable documents. Reconciliation is V1.1: imported/entered bank statement lines are matched to posted cash/bank journal lines; reconciliation status is an audited link, never a deletion of either side.

Open-item allocation is a join between a posted payment/credit and eligible posted receivable/payable items in the same organization/currency (or controlled FX flow). It supports full/partial allocation, one-to-many/many-to-one, advances, customer/supplier credit, overpayment, refunds, credit notes and opening balances. Outstanding = original open-item amount − allocations − linked credits/refunds; it is derived, never manually edited. Allocation cannot exceed the unallocated payment or open-document amount except a separate, explicit advance/credit representation.

## 13. UAE VAT architecture

Tax is jurisdiction/version based: `tax_jurisdiction`, `tax_code`, `tax_rate_version`, effective date, recoverability and GL mapping. Documents snapshot tax code/name/rate/mode/base/tax/rounding at posting; later configuration changes never alter history.

V1 tax codes: Standard Rated 5%, Zero Rated, Exempt, Out of Scope and an architecture hook for Reverse Charge. Support tax-inclusive/exclusive pricing, line-level tax, document rounding, input/output VAT mapping, credit-note reversal and VAT reporting periods. VAT return preparation is a reportable calculation over posted tax lines and period adjustments, with reviewed/locked versions; it is **not** an FTA submission in V1.

### Requires UAE VAT / FTA verification before implementation

- Legal tax-invoice/credit-note fields, wording, Arabic/bilingual obligations and retention.
- TRN validation/verification rules and exemption/zero-rate evidence requirements.
- Exact VAT return boxes, reverse-charge treatment, adjustments, deadlines and filing/export requirements.
- Input-tax recoverability, bad-debt relief, imports/customs and designated-zone rules.
- Rounding rules, exchange-rate treatment, voluntary disclosure and audit-trail obligations.

## 14. Numbering, periods and controls

`document_sequence` is organization-scoped, with document type, optional branch scope, prefix/template, fiscal-year reset policy, next value and uniqueness constraint. Example output: `INV-2026-00001`. Numbers are reserved atomically at post (or draft reservation with expiry) and are never silently reused/changed once posted. Duplicate external supplier invoice reference is warned/blocked according to supplier policy.

Fiscal years contain accounting periods with `open`, `soft_locked`, `hard_locked` state. Soft lock requires elevated authority/reason; hard lock rejects all tenant financial mutations. Month/year close is a guided, audited control—not a destructive data operation.

## 15. Multi-tenant, subscription and platform administration

Model: **Platform → Organization → Branch → Membership/User**. Every tenant-owned table has `organization_id`; branch-scoped records also have `branch_id`. PostgreSQL/Supabase RLS checks active membership, organization context and permitted branch/warehouse scope on every read/write. Service-role credentials live only in server-side trusted operations. Tenant switching is explicit and recorded.

Invitations create membership only after acceptance. Support access is time-bound, organization-specific, read-only by default, requires customer authorization or documented incident policy, displays a banner, and emits immutable audit events. No permanent hidden super-admin access to financial records. Platform administrators manage organizations, plans, trials, subscriptions, activation/suspension, usage, storage, feature entitlements, billing history, health and support tickets; they cannot post/alter customer accounting data.

Feature entitlements use plan-independent keys and limits (`feature_key`, enabled, limit, effective dates), assigned by plan plus organization overrides. This permits Trial/Starter/Business/Pro and paid modules without embedding prices or plan names in business logic. Suspension permits read-only/export grace behavior subject to commercial policy; it never corrupts accounting history.

## 16. Audit-log architecture

Append-only audit events capture organization, branch where relevant, actor/membership, timestamp, request/correlation ID, event type, entity type/ID, source UI/API, previous/new state snapshots or an approved diff, reason, and IP/device metadata only where justified. Events include create/edit, approve/post/cancel/reverse, allocations, reconciliation, invitations/permissions, company/tax setting edits and period locks. Financial audit logs cannot be deleted by tenant users; redaction is a carefully audited privacy operation that preserves event integrity.

## 17. Dashboard and reports

Owner dashboard: Sales Today/This Month, Expenses This Month, gross-profit indicator when data is complete, receivables/payables, cash & bank, VAT position, low stock, overdue invoices, recent activity, cash-flow indicator and Quick Create. Prefer meaningful exceptions over card density. Role dashboards can evolve later; avoid exposing profit/cost to unauthorized users.

| V1 report | Core filters/output |
|---|---|
| Sales / Purchases / Expenses | Date range, branch, customer/supplier, status, item/category, currency; totals, drill-down to document, CSV/XLSX and print/PDF. |
| Receivables / Payables ageing | As-of date, customer/supplier, branch, overdue bands, open-item drill-down, statements. |
| Customer / Supplier Statement | Date/as-of, counterpart, currency; opening, movement, allocation and closing balance. |
| General Ledger / Trial Balance | Period, account/group, branch; opening, debits, credits, closing; document journal drill-down. |
| Profit & Loss / Balance Sheet | Period comparison and branch scope subject to COA policy; totals and underlying ledger drill-down. |
| Stock Summary / Movement / Valuation | As-of/date range, warehouse, item/category; quantity, cost/value and source-movement drill-down. |
| VAT Summary / Input / Output / Return Preparation | VAT period, tax code, document date/accounting date; taxable base, tax, adjustments and retained calculation version. |

All reports use consistent saved filters, pagination, server-side access control and rounded display while retaining precise stored amounts. CSV is V1; branded PDF/XLSX are V1 if commercially required, otherwise V1.1. Every export is permissioned and audited.

## 18. UX principles

- Fewer menus; global search and contextual “Create” actions.
- Responsive, keyboard-friendly SaaS layout with searchable selectors and accessible labels.
- Clear status badge and primary action: Save Draft, Approve, Post, Cancel/Reverse.
- Show financial/stock impact before post; confirmations identify irreversible consequences.
- Use progressive disclosure and sensible defaults; never show irrelevant jurisdiction/vertical fields.
- Safe autosave for draft form fields only; never auto-post, auto-allocate or auto-reconcile.
- Useful empty states, inline validation, clear duplicates/credit-limit/negative-stock warnings.
- Preserve a stable document timeline: activity, journal, allocations, stock movements and audit history.

## 19. Proposed domain model

| Group | Entity | Purpose / key relationships |
|---|---|---|
| Platform | Organization, Plan, FeatureEntitlement, Subscription, SupportAccessGrant | Tenant lifecycle, commercial controls and audited support. |
| Organization | Branch, Warehouse, FiscalYear, AccountingPeriod, DocumentSequence, OrganizationSetting | Legal entity, operational scope, dates and settings. |
| Identity | User, Membership, Role, Permission, RolePermission, MembershipRole, ScopeGrant, Invitation | User belongs to one/many organizations with scoped permissions. |
| Accounting | Account, AccountGroup, Journal, JournalLine, OpeningBalance, Currency, ExchangeRate | Balanced books; Journal/JournalLine link back to source documents. |
| Sales | Customer, SalesQuotation, SalesOrder, DeliveryNote, SalesInvoice, SalesLine, SalesCreditNote | Customer lifecycle; each header has immutable posted snapshot and lines. |
| Purchases | Supplier, PurchaseOrder, GoodsReceipt, PurchaseBill, PurchaseLine, PurchaseDebitNote | Supplier lifecycle and receipt-to-bill traceability. |
| Inventory | Item, ItemCategory, Unit, ItemPrice, ItemWarehousePolicy, InventoryMovement, InventoryBalance | Item catalog and append-only stock event stream. |
| Banking | CashBankAccount, Receipt, Payment, Transfer, Allocation, BankStatementLine, ReconciliationMatch | Money movement and open-item settlement. |
| Tax | TaxJurisdiction, TaxCode, TaxRateVersion, TaxPeriod, TaxAdjustment, TaxTransaction | Tax configuration/snapshots/report preparation. |
| Reporting | SavedReport, ReportExport | Saved filters and audited generated exports; financial reports derive from journals. |
| Audit | AuditEvent, EntityRevision, PostingRun | Immutable operating history, state revisions and posting correlation. |

All financially relevant entities carry stable UUIDs, `organization_id`, timestamps, actor metadata and lifecycle state; branch-specific ones carry `branch_id`. Money stores ISO currency + decimal amount, with base-currency values/rates captured at posting.

## 20. Critical V1 business rules

1. A posted journal must balance in base currency and have at least two lines.
2. Posted financial/stock documents cannot be edited or hard-deleted.
3. Every correction is a linked credit/debit note, reversal or correcting document in an open period.
4. Closed periods reject posting, reversal and configuration changes that alter historical reports.
5. Every posted stock quantity change has exactly one immutable movement source; invoice-after-delivery cannot move stock twice.
6. Document sequences are unique in their organization/type/scope and posted numbers never change.
7. Tenant/branch/warehouse authorization is enforced on all queries and mutations.
8. Tax calculation stores tax rate/version/base/rounding at posting.
9. Payment allocation never creates or edits a balance directly; it only links posted open items.
10. Allocation cannot exceed available payment/open amount except explicit, separately represented advance/credit.
11. Archived masters remain resolvable in historical documents; they cannot be reused in new documents.
12. Account/tax/item mappings required by posting must be valid before post.
13. Every journal line and stock event keeps an originating-document reference.
14. Reconciliation only links eligible posted bank/cash lines and is reversible with audit.
15. System-controlled accounts cannot be deleted, retyped or remapped once used without controlled migration.
16. Every privileged action requires a membership/permission check and creates an audit event.

## 21. Edge cases and expected behavior

| Case | Expected behaviour |
|---|---|
| Part-paid invoice then credit note | Credit note reduces invoice open amount; any excess becomes customer credit/refund workflow, never a negative editable balance. |
| Wrong customer on posted invoice | Issue linked credit note/reversal and a new correct invoice; retain both audit trails. |
| Posting in locked period | Reject; allow only controlled later-period correcting entry or authorized temporary unlock with audit. |
| Negative stock | Block by default with exact item/warehouse deficit; privileged exception follows organization policy and warning/audit. |
| Tax rate changes | Create a new effective tax-rate version; historic posted lines retain snapshot. |
| Advance before invoice | Post receipt/payment to customer/supplier advance liability/asset/open credit; allocate later. |
| Multi-currency rounding | Store source/base amount and locked FX rate; post explicit rounding/FX gain-loss rules only after approval in V1.1. |
| Duplicate invoice number | Database uniqueness rejects internal sequence collision; supplier external-reference duplicate detection warns/blocks by policy. |
| Archived/deleted product on history | Archive only; old documents preserve snapshot; new line selection excludes item. |
| Subscription suspension | Stop new drafts/posting according to plan/grace policy, preserve read-only access/export, never delete/alter books. |
| User loses branch access mid-session | Subsequent server checks reject access; client refreshes context and hides restricted data. |

## 22. Development roadmap

| Batch | Objective, scope and dependencies | Acceptance criteria / tests |
|---|---|---|
| 1. Foundation | Auth, platform/org/branch, membership, RLS, entitlement skeleton, audit foundation. Dependency: none. | Cross-tenant/branch access denied; invitation and context switching audited; RLS integration tests. |
| 2. Company setup | Organization settings, currency/AED, fiscal years/periods, sequences, COA template. Depends 1. | Isolated setup; unique numbering; immutable/system accounts; close policy tests. |
| 3. Roles | Templates, custom grants, scopes, settings access. Depends 1–2. | Permission matrix passes API/UI tests; cost/profit/branch restrictions demonstrated. |
| 4. Accounting core | Accounts, journals/lines, posting service, opening balances, GL/TB. Depends 2–3. | Atomic balanced posting; closed period rejection; ledger reconciles to TB. |
| 5. Masters | Customers, suppliers, items/services, categories, units, warehouses. Depends 2–3. | Validation/archive/duplicate behavior and RLS tests. |
| 6. Sales | Quotes, invoices, tax snapshots, credit notes, PDFs. Depends 4–5 + VAT baseline. | Invoice journal balances, immutable post, credit-note traceability, document-number tests. |
| 7. Purchases/expenses | Bills, debit notes, expenses, tax/inventory mapping. Depends 4–6. | Payable and input-VAT posting/report tests. |
| 8. Payments/allocation | Cash/bank accounts, receipts/payments/transfers, allocations, ageing. Depends 4, 6, 7. | Partial/many-to-many/advance/overpayment scenarios reconcile. |
| 9. Inventory | Opening, direct-sale stock, goods movements, valuation, reports. Depends 5–8. | No duplicate movement; returns/transfers/adjustments preserve balances and journals. |
| 10. VAT | Tax periods, summary/return preparation, controls. Depends 4, 6–8; external validation. | Tax snapshots and reports reconcile to GL; accountant-reviewed UAE test cases pass. |
| 11. Reports/dashboard | V1 reports, drill-down/export, focused dashboard. Depends 4–10. | Report totals reconcile to journals/open items/stock; permissioned export test. |
| 12. V1.1 operations | Orders/delivery/GRN, transfers, recurring, reconciliation, approvals, attachments/multi-currency. Depends V1. | Source conversion prevents double stock/posting; reconciliation and FX suites pass. |
| 13. SaaS/commercial | Subscription workflows, limits, support access and tenant admin. Depends 1, V1. | Suspension/read-only/grace and support-access audit tests pass. |

## 23. Testing strategy

Use unit tests for money, tax, sequences, lifecycle transitions and allocation; property/fixture tests for journal balancing; integration tests for atomic posting, period locks, RLS, permissions, inventory movements and report reconciliation; and browser E2E tests for critical user paths. Browser tests never replace accounting-engine tests.

Minimum accounting test matrix: every V1 posting rule; tax inclusive/exclusive/rounding; returned items; partial/full/multi-invoice allocations; advance/refund/credit; double-entry equality; currency conversion where enabled; stock delivery vs direct invoice; closed periods; concurrency/idempotency; tenant/branch leakage attempts; reports reconciling to journals and open items. Use non-production synthetic accounting data only.

## 24. Known unknowns and approval gates

Before technical architecture/implementation, obtain written accountant/UAE tax review for VAT rules, tax-invoice format, chart-of-accounts template, inventory valuation method, period-close/reversal policy, retained-record/audit requirements, and the treatment of advances/refunds/foreign currency. Decide commercial policy for approval workflows, negative-stock overrides, branch numbering, support access and suspension/grace behavior.

This specification deliberately does **not** infer compliance from Proffin and does not include its proprietary source, APIs, database or credentials.
