create type public.business_document_status as enum ('draft','posted','reversed');
create type public.open_item_kind as enum ('receivable','payable');
create type public.open_item_status as enum ('open','partial','settled');

create table public.customers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, trn text, email text, phone text, billing_address text, payment_terms_days integer not null default 30 check(payment_terms_days>=0), is_active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table public.suppliers (like public.customers including all);
create table public.sales_invoices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), branch_id uuid references public.branches(id), customer_id uuid not null references public.customers(id), invoice_number text, invoice_date date not null, due_date date not null, reference text, notes text, status public.business_document_status not null default 'draft', subtotal numeric(20,6) not null default 0, tax_total numeric(20,6) not null default 0, grand_total numeric(20,6) not null default 0, posted_journal_id uuid references public.journal_entries(id), posted_at timestamptz, posted_by uuid references auth.users(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,invoice_number)
);
create table public.sales_invoice_lines (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.sales_invoices(id) on delete cascade, organization_id uuid not null references public.organizations(id), description text not null, quantity numeric(20,6) not null check(quantity>0), unit_price numeric(20,6) not null check(unit_price>=0), discount numeric(20,6) not null default 0 check(discount>=0), tax_rate_id uuid references public.tax_rates(id), revenue_account_id uuid references public.accounts(id), created_at timestamptz not null default now()
);
create table public.purchase_bills (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), branch_id uuid references public.branches(id), supplier_id uuid not null references public.suppliers(id), bill_number text, bill_date date not null, due_date date not null, reference text, notes text, status public.business_document_status not null default 'draft', subtotal numeric(20,6) not null default 0, tax_total numeric(20,6) not null default 0, grand_total numeric(20,6) not null default 0, posted_journal_id uuid references public.journal_entries(id), posted_at timestamptz, posted_by uuid references auth.users(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,bill_number)
);
create table public.purchase_bill_lines (
 id uuid primary key default gen_random_uuid(), bill_id uuid not null references public.purchase_bills(id) on delete cascade, organization_id uuid not null references public.organizations(id), description text not null, quantity numeric(20,6) not null check(quantity>0), unit_price numeric(20,6) not null check(unit_price>=0), discount numeric(20,6) not null default 0 check(discount>=0), tax_rate_id uuid references public.tax_rates(id), expense_account_id uuid not null references public.accounts(id), created_at timestamptz not null default now()
);
create table public.open_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), kind public.open_item_kind not null, customer_id uuid references public.customers(id), supplier_id uuid references public.suppliers(id), source_journal_id uuid not null references public.journal_entries(id), source_document_id uuid not null, original_amount numeric(20,6) not null check(original_amount>0), due_date date, status public.open_item_status not null default 'open', created_at timestamptz not null default now(), check((kind='receivable' and customer_id is not null and supplier_id is null) or (kind='payable' and supplier_id is not null and customer_id is null)), unique(source_journal_id)
);
alter table public.customers enable row level security; alter table public.suppliers enable row level security; alter table public.sales_invoices enable row level security; alter table public.sales_invoice_lines enable row level security; alter table public.purchase_bills enable row level security; alter table public.purchase_bill_lines enable row level security; alter table public.open_items enable row level security;
create policy customers_member on public.customers for select to authenticated using(public.is_active_org_member(organization_id));
create policy suppliers_member on public.suppliers for select to authenticated using(public.is_active_org_member(organization_id));
create policy invoices_member on public.sales_invoices for select to authenticated using(public.is_active_org_member(organization_id));
create policy invoice_lines_member on public.sales_invoice_lines for select to authenticated using(public.is_active_org_member(organization_id));
create policy bills_member on public.purchase_bills for select to authenticated using(public.is_active_org_member(organization_id));
create policy bill_lines_member on public.purchase_bill_lines for select to authenticated using(public.is_active_org_member(organization_id));
create policy open_items_member on public.open_items for select to authenticated using(public.is_active_org_member(organization_id));
revoke all on public.customers,public.suppliers,public.sales_invoices,public.sales_invoice_lines,public.purchase_bills,public.purchase_bill_lines,public.open_items from anon;
grant select on public.customers,public.suppliers,public.sales_invoices,public.sales_invoice_lines,public.purchase_bills,public.purchase_bill_lines,public.open_items to authenticated;

create or replace function public.ensure_business_document_sequences(p_organization_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.assert_accounting_owner(p_organization_id);
  insert into public.document_sequences(organization_id,document_type,prefix)
  values (p_organization_id,'purchase_bill','BILL-')
  on conflict (organization_id,branch_id,document_type,financial_year_id) do nothing;
end; $$;
revoke all on function public.ensure_business_document_sequences(uuid) from public,anon;
grant execute on function public.ensure_business_document_sequences(uuid) to authenticated;
