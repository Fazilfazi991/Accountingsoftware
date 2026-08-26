# Proffin ERP — Read-only product audit

**Audit date:** 23 August 2026  
**Source:** authenticated, production Chrome session; visible UI and read-only route inspection only.  
**Safety:** no records were created, edited, saved, submitted, posted, approved, reconciled, cancelled, exported, or deleted. Customer/vendor names, balances, contacts and banking details are intentionally omitted or redacted.

## A. Executive summary

Proffin is a broad, legacy-style ERP rather than a focused accounting application. Its core is an integrated inventory and double-entry accounting system: sales, purchases, stock, cash/bank, cheque, allocation and journals share reporting and ledger infrastructure. It is configured for AED and an Abu Dhabi (UTC+04) timezone in the observed company context, with inventory and tax features enabled.

The installed menu also includes vertical/optional suites: production, HRMS, payroll, CRM, restaurant POS, garage, logistics, projects/construction, import tools and financial-period closing. This makes it appropriate for complex trading/service operations, but produces a very large navigation surface and duplicate variants of the same workflow.

The most reusable product learning is the accounting model: transaction codes drive documents; stock transactions feed item movement; sales/purchases and cash transactions produce voucher-level debit/credit entries; invoice/receipt allocation supports open balances. The most important thing *not* to copy is the screen architecture: it exposes many generic, India-oriented and customer-specific fields/routes in common UAE sales flows.

## B. Observed context and controls

| Area | Observed result |
|---|---|
| Product | `Proffin ERP [2026]` |
| Signed-in user | Redacted in this report; an individual user name was shown in the header. |
| Company context | Proffin ERP sample/company context; company contact/bank details redacted. |
| Warehouse context | `General` warehouse. |
| Currency | Emirati Dirham (AED); two decimal places. |
| Timezone/date | `(UTC+04:00) Abu Dhabi`; `dd-mm-yy`. |
| Enabled capabilities | Inventory, multi-packing, taxes, colour/size categorisation, ecommerce. |
| Financial year | 2026 appears throughout the dashboard/report filters. The actual opening/closing rule was not safely verified. |
| User model | User Types, Admin Users, Privilege Master, User Privileges and Employee Privileges. Privilege Master groups task checkboxes and has “Enable Other Users”. |

Evidence routes: `/Users/home`, `/config/Configuration/company`, `/Users/PrivilegeMaster`.

## C. Module map / menu inventory

The following is the complete *identifiable* high-level map from the authenticated navigation. Routes are shown where visible; `#`/JavaScript entries are expandable groups rather than pages.

| Module | Submodules/pages observed | Key purpose/actions |
|---|---|---|
| Dashboard | Dashboard; Day Open/Close | KPI cards, shortcuts, outstanding/transaction widgets, day/cash operations. |
| IMS — transactions | Sales Quotations (`SQT`); Sales Orders (`SOR1`); Restaurant Orders; Dummy GDN/Invoice; Proforma branch 1/2; Goods Delivery Note (`GDN`); Sales Invoice (`SAL7`); branch invoice (`SAL8`); Wholesale (`SALW`); Sales (`SAL3`); Simple Sales (`SAL`); POS (`POS1`); Sales Return (`SRT1`); Debit Note (`SRT2`) | Quote-to-order-to-delivery-to-invoice variants, POS, returns. Create pages use `/ims/Transaction/NewTransaction/{code}`. |
| IMS — purchasing | Purchase Quotations (`PQT`); Purchase Order (`POR1`); Goods Receive Note (`GRN`); Purchase Invoice (`PUR1`); branch invoice (`PUR2`); Purchase Return (`PRT1`); Credit Note (`PRT2`) | Supplier purchasing, receipt, bill and return flow. |
| IMS — expenses & stock | Expense Entry (`EXP`); Warehouse Transfer; Adjustment; Stock Closing; Stock Taking; Manage Opening Stock; import sales/cash transactions | Expense and physical stock maintenance. Closing/taking actions are sensitive and were not exercised. |
| IMS — cash/bank | Cash Payment (`CP`); Cash Receipt (`CR`); Bank Deposit (`BD`); Bank Withdrawal (`BW`); Cheque Payment (`QP`); Cheque Receipt (`QR`); Journal Entry; Unset Adjusted Entry | Cash/bank movements, cheques, journal and allocation correction. |
| IMS — reports | Product/stock search, daily, RFP verification, price list stock, cash counter, expiry, item-used, sales details, all transactions, transaction details, transaction summary, conversion summary, stock, outstanding, profit reports | Filterable list/detail reporting, with transaction-type branches. |
| Accounts | Account Ledgers, Groups, Departments, Currency, Voucher Master, Allocation, Bank Payment Mode; financial/account books, cheque and summary reports; P&L, Balance Sheet, Trial Balance | Chart of accounts, voucher and payment configuration, financial reporting. |
| Production | Manufacturing transaction; manufacturing register and summaries; production registration and summaries; Ingredient master | BOM/ingredient and manufacturing workflow. |
| HRMS | Dashboard; attendance; leave; reports; employee/branch/designation/bank/visa masters | HR administration and attendance. |
| Payroll | Allowance/recovery/loan, attendance processing, PayBill, Account Posting, payslip payment/drop, gratuity/end of service; payroll configuration/reports | Payroll processing, including explicit accounting posting. |
| CRM | Dashboard, Action Board, Enquiry Register, stages/sources/office location, enquiry/action/deal/meeting reports | Lead and follow-up management. |
| Restaurant | Restaurant POS/return; cash counter/product reports; section/table/waiter/kitchen/menu/preference masters | Hospitality vertical. |
| Garage | Job order, service, service invoice, insurance, model | Workshop vertical. |
| Logistics | Dashboard; Job Card, SABER Tracker, Job Costing Sheet; profit/closed-card reports; broker/forwarder/location/charges masters | Freight/logistics job costing. |
| Tools | Month Closing, Financial Year Closing, master/product imports, invoice-setoff, cash-to-credit conversion | Administrator/migration/period-control tools. |
| Configuration | Company/contact details, dashboard items, General/Account/Inventory/IMS/Production/Expense/Barcode/HRMS/Payroll/CRM/Garage settings | Tenant and application setup. |
| Users Management | User Types, Admin Users, Privilege Master, User Privileges, Employee Privileges | Role/task access management. |

### Important report inventory

| Report family | Identified reports/capability |
|---|---|
| Financial | Profit & Loss, Balance Sheet, Trial Balance, Cash Book, Bank Book, Reconciliation Bank Book, Ledger Book, Customer Statement, Voucher Book, Allocation Book, Ledger Allocation Summary, group books. |
| Sales/purchases | Sales Details, All Transaction Report, transaction-detail lists per code, conversion summaries, item-wise and transaction-type summaries, outstanding invoice/customer/supplier reports, product/department/category profit. |
| Inventory | Product Stock Search, stock movement details, Product Book, reorder quantity, real-stock, stock ageing and movement-summary branches, expiry and item-used reports. |
| Cash/cheque | Cheque deposit/clearance/bounce/return reports; ledger summary; receipt/payment and deposit/withdrawal summaries. |
| Vertical | Manufacturing/production, attendance/leave/payroll, CRM, restaurant and logistics reports. |

Sample evidence: `/ims/Report/SalesSummeryReport/List_Allsales`. Its filters include transaction/entry date, customer, warehouse, item, allocation, creator, salesperson, currency, payment status, conversion status, transaction name/invoice number and keyword. The table exposes warehouse, invoice/date, customer, currency, allocation, items, amount, tax, discounts, grand/payable totals, advance, bank and balance. Buttons shown: Filter, Print and Export. PDF/Excel file types were not safely verified.

## D. Workflow documentation

### Sales and receivables

Observed document-code sequence: **Sales Quotation (`SQT`) → Sales Order (`SOR1`) → Goods Delivery Note (`GDN`) → Sales Invoice (`SAL7`) → Cash/Bank/Cheque Receipt (`CR`/`BD`/`QR`) → allocation/outstanding/account books**. Dashboard shortcuts and transaction lists support the same sequence. Variants (branch, wholesale, simple, POS, restaurant) are separate transaction codes rather than a single adaptive workflow.

The dashboard’s latest accounting entries demonstrate automatic double-entry behavior: a sale creates customer debit, sales-account credit and VAT credit; a cash receipt debits cash and credits the customer. That is observed behavior, not a substitute for testing all posting combinations.

### Purchases and payables

The available sequence is **Purchase Quotation (`PQT`) → Purchase Order (`POR1`) → Goods Receive Note (`GRN`) → Purchase Invoice (`PUR1`) → Cash/Bank/Cheque Payment (`CP`/`BW`/`QP`) → supplier outstanding/account books**. Purchase return (`PRT1`) and credit note (`PRT2`) are distinct transaction types. Exact conversion rules, posting timing and whether GRN creates accruals require a safe test tenant.

### Expenses, banking and cheques

`EXP` records expenses, while cash/bank voucher types create explicit payment, receipt, deposit, withdrawal and cheque workflows. Reconciliation Bank Book and a `BankReconciliation` permission task establish that reconciliation exists, but no reconciliation was opened or performed. Cash/bank allocation and the Allocation Book indicate receivable/payable settlement support.

### Inventory and production

Items can be managed with opening stock, warehouse transfer, adjustment, stock closing and stock-taking flows. Product-level UI supports multi-pack, available quantity, batches, expiry and serial numbers; reports cover movement, ageing, reorder and product book. Manufacturing references ingredients and production registration, indicating an inventory-consuming production feature. Valuation method and exact accounting entries (COGS, stock-in-transit, write-offs) were not visible and remain unverified.

### Returns/notes

Sales Return and Debit Note live in sales; Purchase Return and Credit Note in purchases. Their transaction separation suggests stock and ledgers can be reversed/adjusted, but exact source-document linkage, tax reversal, and whether returns are always stock-moving need safe-test validation.

## E. Representative transaction form — Sales Invoice (`SAL7`)

| Area | Fields/actions observed |
|---|---|
| Header | Invoice number/prefix, customer, transaction date, WhatsApp number, customer reference/date, VAT number, salesperson, currency and rate, payment type, allocation, cash/card/POS/online ledgers, payment terms, reference, narration, vehicle/chassis/engine. |
| Lines | Product code/name/barcode, stock/available quantity, unit/pack, batch/expiry, serial number, quantity/weight/pieces, rate, amount, discount/discount %, commission, other charge, tax %, tax amount/category/on, and net amount. |
| Footer | Amount, discount, other, tax, rounding, net total, real-currency total, credit, advance, bank amount, due date, cash currency, cash/balance, attachments/documents. |
| Actions | Save as Draft; Save Transaction; add/delete selected row; validation prompt. No approved/post/print/email action was observed on this create screen. |
| Controls inferred | Auto-prefilled invoice sequence/prefix and a hidden original number; credit-limit/reference warning flags; stock/rate/min-selling-rate warning flags; conversion IDs; draft state. Exact enforcement was not tested. |

The same form additionally exposes GSTIN/UIN, states, e-way bill, consignor/consignee, transporter and dispatch/shipping fields. These look like India localization or a shared cross-country form. They should not be presented in a UAE-first invoice workflow by default.

## F. UAE VAT/localization findings

**Observed:** AED; UAE timezone; Company VAT No field; taxes enabled; invoice headers/lines expose VAT number, tax percentage/category/on and tax totals; dashboard accounting entries include a `VAT 5%` account; Arabic company/address fields are available.

**Not safely verified:** TRN format validation, VAT codes for standard/zero/exempt/reverse-charge, tax-period setup, UAE FTA return, VAT report/e-filing, credit-note VAT treatment, source-document tax controls, or tax-invoice legal layout. The UI’s GST/e-way-bill/state fields are a localization contamination risk, and the existing UI must not be treated as proof of UAE VAT compliance.

## G. Roles, permissions and accounting controls

Permissions are task-oriented. Privilege Master is grouped (e.g., an Accounts block) with per-task checkboxes and an “Enable Other Users” column; an observed task was `BankReconciliation`. User types and separate admin/employee privilege pages indicate user-type and user-specific assignment. Page/module/action coverage is likely, but create/edit/delete/approve granularity was not proven.

Document numbering is code/prefix driven: e.g., Sales Invoice `SAL7` displayed a configured prefix plus a sequential number; reports and the dashboard link accounting entries through voucher codes (`SL`, `CR`, `CP`, `BD`, `QP`, `QR`, `OP`, `PU`). Financial-year and month-closing pages exist. The dashboard contains cancelled transaction reporting, which suggests cancellation history is retained. Whether posted transactions can be edited/deleted, whether there are immutable audit logs/reversal vouchers, and financial-year resets require a safe environment.

## H. Dashboard assessment

Useful operational cards include month/today sales, cash receipt/bank receipt, POS sale, cash on hand, bank cash, total receivable/payable. Widgets include latest outstanding invoices, deposited cheques, transaction-type summary, sales analysis, expense analysis, voucher-wise amount, latest accounting transactions and stock movement; shortcuts cover high-frequency sales/purchase/cash/inventory actions.

Keep: receivables/payables, cash/bank, latest exceptions, drill-down links and period-specific KPI cards. Redesign: reduce duplicated cards/transaction variants, let owners choose a focused dashboard, distinguish exceptions from normal activity, and avoid showing production-level customer data by default.

## I. Likely data model (inferred, not extracted)

```text
Organization 1─* Branch/Warehouse 1─* InventoryBalance
Organization 1─* User *─* Role *─* Permission
Organization 1─* FiscalYear 1─* AccountingPeriod
AccountGroup 1─* Account; Account 1─* JournalLine *─1 Journal
Customer/Supplier ──> Account (control account)
ItemCategory 1─* Item; Item 1─* ItemUnit/Price/TaxProfile
SalesDocument 1─* SalesLine ──> Item; SalesDocument ──> Customer
PurchaseDocument 1─* PurchaseLine ──> Item; PurchaseDocument ──> Supplier
InventoryMovement ──> Item + Warehouse + source document
Payment/Receipt ──> CashBankAccount + Counterparty; Allocation joins payment to open document
TaxCode/TaxRate ──> DocumentLine/JournalLine
AuditEvent ──> every mutable business record
```

## J. Feature classification for a new UAE SaaS

| Priority | Recommendation |
|---|---|
| P0 — MVP | Tenancy/company/branch, UAE-ready chart of accounts, fiscal periods, customers/suppliers, items/services, quotations/invoices/bills, credit/debit notes, cash/bank payments and allocations, automated balanced journals, VAT 5% and tax codes, receivable/payable/ledger/trial-balance/P&L/balance-sheet reports, PDF tax invoice, roles, audit log, imports and safe cancel/reversal policy. |
| P1 | Purchase orders/GRNs, stock movement/adjustment/transfer/reorder, bank reconciliation, multi-currency, attachments, approval workflows, reporting export, dashboards, document templates, WhatsApp/email integration. |
| P2 | Serial/batch/expiry, manufacturing/BOM, POS, multiple price lists, cost centres/projects, cheque lifecycle, advanced inventory valuation, mobile capture. |
| P3 | Restaurant, garage, logistics/SABER, HRMS/payroll/leave, CRM, construction/project verticals, ecommerce. Treat as separately saleable modules. |
| Do not replicate | Separate transaction codes/screens for nearly identical sales workflows; India GST/e-way-bill fields in UAE default flows; generic “dummy” documents; dated terminology/spelling; menu-first navigation with enormous duplicate report trees; destructive close/adjustment tools exposed alongside everyday work. |

## K. Recommended future architecture (not implemented)

Use Next.js + TypeScript for a modern responsive app, with PostgreSQL/Supabase for tenancy, RLS and auth. Every business table carries `organization_id`; branch-constrained data also carries `branch_id`. RLS must enforce membership and role grants, while server-side command handlers own privileged writes.

Accounting should be a locked posting engine: a transaction enters draft/approved/posted/cancelled states; posting atomically creates a balanced immutable journal; corrections create reversals/credit notes rather than editing history. Use idempotency keys, per-document sequence ranges, database constraints, append-only audit events, and controlled period locks. Keep tax calculation/versioning explicit (`tax_code`, effective dates, jurisdiction) and make VAT return data a reportable ledger view, not a mutable summary.

Platform level: plans, module entitlements, support/impersonation controls, templates, country packs, telemetry and migration tooling. Tenant level: legal entity, TRN, base currency, COA, tax codes, fiscal year, numbering, templates, banks and feature settings. Branch level: warehouse/location, permitted users, local numbering/stock. User level: roles and scoped grants. Avoid a shared super-admin database role; enforce organization isolation in both RLS and server commands.

## L. Development roadmap

1. Foundation: tenancy, auth, RLS, role model, audit trail, company/branch/settings, fiscal calendar and sequences.
2. Accounting core: COA, journals/posting engine, opening balances, period lock, ledger/trial balance/financial statements.
3. Commercial core: customers/suppliers, tax codes, items/services, quotations, sales invoices, purchase bills, PDFs.
4. Settlement: payments/receipts, allocation, bank/cash, outstanding/ageing, credit/debit notes.
5. Inventory and VAT: warehouses, movements, stock reports, UAE VAT return/reporting.
6. Growth: approvals, imports/exports, reconciliation, dashboards, attachments and integrations.
7. Optional vertical modules only after the core has strong controls and adoption.

## M. Existing product vs. recommended product

| Area | Existing Proffin behavior | Keep | Improve | Remove | Recommended approach |
|---|---|---:|---:|---:|---|
| Accounting | Voucher codes, journals, books and financial statements | Yes | Yes | No | Immutable posting engine with human labels and clear lifecycle. |
| Sales | Many code-specific invoice/order variants | Core flow | Yes | Variants as menus | One adaptive document flow with templates/feature flags. |
| Inventory | Stock, batch/serial, transfer, adjustment, closing, reports | Yes | Yes | Unsafe clutter | Event-based movements and explicit permissions. |
| VAT | VAT/tax fields, VAT 5% account, but GST/e-way fields visible | Tax engine | Major | India defaults | UAE country pack and FTA-oriented tax controls. |
| Navigation | Large nested, duplicated tree | Module grouping | Major | Duplication | Role-aware task navigation and global search. |
| Dashboard | Strong breadth and drilldowns | KPIs/drilldowns | Major | Noise | Persona-specific dashboards and exception alerts. |
| Permissions | Task-level privilege UI | Granularity | Yes | Misspellings/complexity | Roles + scoped policy grants + reviewable audit trails. |
| Vertical modules | Restaurant, garage, logistics, HR/payroll, CRM | Optional ideas | Modularize | Bundled default | Isolated paid modules with bounded schemas. |

## N. Questions / safe-test backlog

1. Which document transitions create stock and journal postings, and when are they irreversible?
2. How does allocation behave for partial payments, overpayments, refunds, credit notes and foreign currency?
3. What stock valuation method is used and how do adjustments/returns affect COGS?
4. What UAE VAT rates/codes/returns/validations actually exist?
5. Which document states can be edited, deleted, cancelled or reversed, and is there a durable audit log?
6. Does permissioning distinguish view/create/edit/delete/approve/export by company, branch, warehouse and report?
7. How are sequences managed across fiscal years, branches and imports?
8. What report exports, drill-downs and PDF formats work in practice?
9. Does bank reconciliation import statements, enforce matching and prevent duplicate reconciliation?
10. What APIs/integrations are licensed and documented? No hidden APIs or private database were inspected.

All items above marked unknown require a **safe, non-production test environment** before they inform detailed product requirements.
