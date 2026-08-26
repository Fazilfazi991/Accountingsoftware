-- Phase 2: accounting setup only. No journal, transaction, or ledger posting exists here.
create type public.account_classification as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.financial_year_status as enum ('open', 'closed');
create type public.accounting_period_status as enum ('open', 'locked');
create type public.opening_balance_status as enum ('draft', 'ready');
create type public.tax_treatment as enum ('standard', 'zero_rated', 'exempt', 'out_of_scope');
create type public.document_type as enum ('sales_invoice', 'sales_credit_note', 'purchase_bill', 'purchase_debit_note', 'receipt', 'payment', 'journal');

alter table public.organization_settings add column accounting_initialized_at timestamptz;
alter table public.organization_settings add column vat_registered boolean not null default false;
alter table public.organization_settings add column vat_trn text;
alter table public.organization_settings add column vat_registration_date date;

create table public.account_groups (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'), name text not null check (length(trim(name)) > 0),
  classification public.account_classification not null, parent_group_id uuid references public.account_groups(id),
  system_key text, is_system boolean not null default false, is_active boolean not null default true,
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, system_key)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  account_group_id uuid not null references public.account_groups(id), code text not null check (code ~ '^[0-9]{4}$'),
  name text not null check (length(trim(name)) > 0), description text, account_type text,
  system_key text, is_system boolean not null default false, allow_manual_posting boolean not null default true,
  is_active boolean not null default true, currency_code text not null default 'AED' check (currency_code = 'AED'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, system_key)
);
create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id), branch_id uuid references public.branches(id), name text not null,
  is_default boolean not null default false, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, account_id)
);
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id), branch_id uuid references public.branches(id), bank_name text not null,
  account_name text not null, account_number_masked text, iban text, swift_bic text, currency_code text not null default 'AED' check (currency_code = 'AED'),
  is_default boolean not null default false, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, account_id)
);
create table public.financial_years (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, start_date date not null, end_date date not null, status public.financial_year_status not null default 'open', is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (start_date < end_date), unique (organization_id, name)
);
create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_year_id uuid not null references public.financial_years(id), period_number smallint not null check (period_number between 1 and 12),
  name text not null, start_date date not null, end_date date not null, status public.accounting_period_status not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (start_date <= end_date), unique (financial_year_id, period_number)
);
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null, name text not null, rate_percent numeric(8,4) not null check (rate_percent >= 0 and rate_percent <= 100),
  treatment public.tax_treatment not null, sales_enabled boolean not null default true, purchase_enabled boolean not null default true,
  is_system boolean not null default false, is_active boolean not null default true, effective_from date, effective_to date,
  input_account_id uuid references public.accounts(id), output_account_id uuid references public.accounts(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_from <= effective_to), unique (organization_id, code)
);
create table public.document_sequences (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id), document_type public.document_type not null, prefix text not null default '', next_number bigint not null default 1 check (next_number > 0),
  padding smallint not null default 5 check (padding between 1 and 12), suffix text, reset_policy text not null default 'never' check (reset_policy in ('never', 'financial_year')),
  financial_year_id uuid references public.financial_years(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, branch_id, document_type, financial_year_id)
);
create table public.opening_balance_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_year_id uuid references public.financial_years(id), opening_date date not null, status public.opening_balance_status not null default 'draft', notes text,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.opening_balance_lines (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.opening_balance_batches(id) on delete cascade,
  account_id uuid not null references public.accounts(id), debit_amount numeric(20,6) not null default 0 check (debit_amount >= 0), credit_amount numeric(20,6) not null default 0 check (credit_amount >= 0),
  description text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check ((debit_amount = 0) <> (credit_amount = 0))
);

create index account_groups_organization_idx on public.account_groups(organization_id, sort_order);
create index accounts_organization_idx on public.accounts(organization_id, code);
create index cash_accounts_organization_idx on public.cash_accounts(organization_id);
create index bank_accounts_organization_idx on public.bank_accounts(organization_id);
create index financial_years_organization_idx on public.financial_years(organization_id, start_date);
create index tax_rates_organization_idx on public.tax_rates(organization_id, code);
create index document_sequences_organization_idx on public.document_sequences(organization_id);
create index opening_balance_batches_organization_idx on public.opening_balance_batches(organization_id, opening_date);

create or replace function public.assert_accounting_owner(p_organization_id uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_organization_id) then raise exception 'not_authorized'; end if;
end; $$;
create or replace function public.accounting_audit(p_organization_id uuid, p_event_type text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_membership_id uuid;
begin
  select id into v_membership_id from public.organization_memberships where organization_id = p_organization_id and user_id = (select auth.uid()) and membership_status = 'active';
  insert into public.audit_events(organization_id, actor_user_id, actor_membership_id, event_type, entity_type, entity_id, metadata)
  values(p_organization_id, (select auth.uid()), v_membership_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end; $$;

create or replace function public.initialize_accounting_setup(p_organization_id uuid, p_financial_year_name text default null, p_start_date date default null, p_end_date date default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_year_id uuid; v_start date := coalesce(p_start_date, date_trunc('year', current_date)::date); v_end date := coalesce(p_end_date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date); v_count integer;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if v_start >= v_end then raise exception 'invalid_financial_year'; end if;
  select count(*) into v_count from public.accounts where organization_id=p_organization_id;
  if v_count > 0 then return jsonb_build_object('initialized', true, 'already_initialized', true); end if;
  insert into public.account_groups(organization_id,code,name,classification,system_key,is_system,sort_order) values
    (p_organization_id,'1000','Assets','asset','assets',true,10),(p_organization_id,'1100','Cash','asset','cash',true,20),(p_organization_id,'1200','Bank','asset','bank',true,30),(p_organization_id,'1300','Receivables','asset','receivables',true,40),(p_organization_id,'1400','Inventory & other assets','asset','other_assets',true,50),
    (p_organization_id,'2000','Liabilities','liability','liabilities',true,60),(p_organization_id,'2100','Payables','liability','payables',true,70),(p_organization_id,'2200','VAT & current liabilities','liability','current_liabilities',true,80),
    (p_organization_id,'3000','Equity','equity','equity',true,90),(p_organization_id,'4000','Income','income','income',true,100),(p_organization_id,'5000','Cost of sales','expense','cost_of_sales',true,110),(p_organization_id,'6000','Operating expenses','expense','operating_expenses',true,120);
  insert into public.accounts(organization_id,account_group_id,code,name,account_type,system_key,is_system,allow_manual_posting)
  select p_organization_id,g.id,v.code,v.name,v.account_type,v.system_key,true,v.allow_manual_posting from (values
    ('cash','1110','Cash on Hand','cash','cash_on_hand',true),('bank','1210','Main Bank Account','bank','main_bank',true),('receivables','1300','Accounts Receivable','receivable','accounts_receivable',false),('other_assets','1400','Inventory','inventory','inventory',false),('other_assets','1410','Input VAT Recoverable','tax','input_vat',false),('other_assets','1490','Other Current Assets','asset','other_current_assets',true),
    ('payables','2100','Accounts Payable','payable','accounts_payable',false),('current_liabilities','2200','Output VAT Payable','tax','output_vat',false),('current_liabilities','2290','Other Current Liabilities','liability','other_current_liabilities',true),('equity','3100','Owner Capital','equity','owner_capital',false),('equity','3200','Retained Earnings','equity','retained_earnings',false),('equity','3300','Drawings','equity','drawings',true),
    ('income','4100','Sales Revenue','income','sales_revenue',false),('income','4200','Service Revenue','income','service_revenue',false),('income','4900','Other Income','income','other_income',true),('cost_of_sales','5000','Cost of Goods Sold','expense','cost_of_goods_sold',false),('operating_expenses','6100','Rent Expense','expense','rent_expense',true),('operating_expenses','6200','Salary Expense','expense','salary_expense',true),('operating_expenses','6300','Utilities','expense','utilities',true),('operating_expenses','6400','Office Expense','expense','office_expense',true),('operating_expenses','6500','Marketing Expense','expense','marketing_expense',true),('operating_expenses','6600','Bank Charges','expense','bank_charges',true),('operating_expenses','6700','Professional Fees','expense','professional_fees',true),('operating_expenses','6900','Other Expense','expense','other_expense',true)
  ) as v(group_key,code,name,account_type,system_key,allow_manual_posting) join public.account_groups g on g.organization_id=p_organization_id and g.system_key=v.group_key;
  insert into public.cash_accounts(organization_id,account_id,name,is_default) select p_organization_id,id,name,true from public.accounts where organization_id=p_organization_id and system_key='cash_on_hand';
  insert into public.bank_accounts(organization_id,account_id,bank_name,account_name,is_default) select p_organization_id,id,'Bank','Main Bank Account',true from public.accounts where organization_id=p_organization_id and system_key='main_bank';
  insert into public.financial_years(organization_id,name,start_date,end_date,is_default) values(p_organization_id,coalesce(nullif(trim(p_financial_year_name),''),'FY ' || extract(year from v_start)::text),v_start,v_end,true) returning id into v_year_id;
  insert into public.accounting_periods(organization_id,financial_year_id,period_number,name,start_date,end_date) select p_organization_id,v_year_id,n,to_char(v_start + ((n-1)||' months')::interval,'Mon YYYY'),(v_start + ((n-1)||' months')::interval)::date,least((v_start + (n||' months')::interval - interval '1 day')::date,v_end) from generate_series(1,12) n where (v_start + ((n-1)||' months')::interval)::date <= v_end;
  insert into public.tax_rates(organization_id,code,name,rate_percent,treatment,sales_enabled,purchase_enabled,is_system,input_account_id,output_account_id) values
    (p_organization_id,'VAT5','5% Standard VAT',5,'standard',true,true,true,(select id from public.accounts where organization_id=p_organization_id and system_key='input_vat'),(select id from public.accounts where organization_id=p_organization_id and system_key='output_vat')),
    (p_organization_id,'ZERO','Zero Rated',0,'zero_rated',true,true,true,null,null),(p_organization_id,'EXEMPT','Exempt',0,'exempt',true,true,true,null,null),(p_organization_id,'OOS','Out of Scope',0,'out_of_scope',true,true,true,null,null);
  insert into public.document_sequences(organization_id,document_type,prefix) values (p_organization_id,'sales_invoice','INV-'),(p_organization_id,'receipt','REC-'),(p_organization_id,'payment','PAY-'),(p_organization_id,'journal','JV-');
  update public.organization_settings set accounting_initialized_at=coalesce(accounting_initialized_at,now()) where organization_id=p_organization_id;
  perform public.accounting_audit(p_organization_id,'accounting.initialized','accounting_setup',p_organization_id,jsonb_build_object('financial_year_id',v_year_id));
  return jsonb_build_object('initialized',true,'already_initialized',false,'financial_year_id',v_year_id);
end; $$;

create or replace function public.create_account(p_organization_id uuid,p_code text,p_name text,p_account_group_id uuid,p_description text default null,p_allow_manual_posting boolean default true) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_id uuid:=gen_random_uuid(); begin perform public.assert_accounting_owner(p_organization_id); if not exists(select 1 from public.account_groups where id=p_account_group_id and organization_id=p_organization_id and is_active) then raise exception 'invalid_account_group'; end if; insert into public.accounts(id,organization_id,account_group_id,code,name,description,allow_manual_posting) values(v_id,p_organization_id,p_account_group_id,trim(p_code),trim(p_name),nullif(trim(p_description),''),p_allow_manual_posting); perform public.accounting_audit(p_organization_id,'account.created','account',v_id); return v_id; end; $$;
create or replace function public.update_account(p_organization_id uuid,p_account_id uuid,p_code text,p_name text,p_account_group_id uuid,p_description text,p_allow_manual_posting boolean,p_is_active boolean) returns void language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_system boolean; begin perform public.assert_accounting_owner(p_organization_id); select is_system into v_system from public.accounts where id=p_account_id and organization_id=p_organization_id; if v_system is null then raise exception 'not_found'; end if; if v_system and not p_is_active then raise exception 'system_account_protected'; end if; update public.accounts set code=trim(p_code),name=trim(p_name),account_group_id=p_account_group_id,description=nullif(trim(p_description),''),allow_manual_posting=p_allow_manual_posting,is_active=p_is_active where id=p_account_id and organization_id=p_organization_id; perform public.accounting_audit(p_organization_id,case when p_is_active then 'account.updated' else 'account.deactivated' end,'account',p_account_id); end; $$;
create or replace function public.create_account_group(p_organization_id uuid,p_code text,p_name text,p_classification public.account_classification) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_id uuid:=gen_random_uuid(); begin perform public.assert_accounting_owner(p_organization_id); insert into public.account_groups(id,organization_id,code,name,classification,sort_order) values(v_id,p_organization_id,trim(p_code),trim(p_name),p_classification,999); perform public.accounting_audit(p_organization_id,'account_group.created','account_group',v_id); return v_id; end; $$;
create or replace function public.create_financial_year(p_organization_id uuid,p_name text,p_start_date date,p_end_date date,p_is_default boolean default false) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_id uuid:=gen_random_uuid(); begin perform public.assert_accounting_owner(p_organization_id); if p_start_date>=p_end_date or exists(select 1 from public.financial_years where organization_id=p_organization_id and daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')) then raise exception 'invalid_or_overlapping_financial_year'; end if; if p_is_default then update public.financial_years set is_default=false where organization_id=p_organization_id; end if; insert into public.financial_years(id,organization_id,name,start_date,end_date,is_default) values(v_id,p_organization_id,trim(p_name),p_start_date,p_end_date,p_is_default); perform public.accounting_audit(p_organization_id,'financial_year.created','financial_year',v_id); return v_id; end; $$;
create or replace function public.update_document_sequence(p_organization_id uuid,p_sequence_id uuid,p_prefix text,p_next_number bigint,p_padding smallint,p_suffix text) returns void language plpgsql security definer set search_path = pg_catalog, public as $$ begin perform public.assert_accounting_owner(p_organization_id); update public.document_sequences set prefix=trim(p_prefix),next_number=p_next_number,padding=p_padding,suffix=nullif(trim(p_suffix),'') where id=p_sequence_id and organization_id=p_organization_id; if not found then raise exception 'not_found'; end if; perform public.accounting_audit(p_organization_id,'document_sequence.updated','document_sequence',p_sequence_id); end; $$;
create or replace function public.create_opening_balance_batch(p_organization_id uuid,p_financial_year_id uuid,p_opening_date date,p_notes text default null) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_id uuid:=gen_random_uuid(); begin perform public.assert_accounting_owner(p_organization_id); if p_financial_year_id is not null and not exists(select 1 from public.financial_years where id=p_financial_year_id and organization_id=p_organization_id) then raise exception 'invalid_financial_year'; end if; insert into public.opening_balance_batches(id,organization_id,financial_year_id,opening_date,notes,created_by) values(v_id,p_organization_id,p_financial_year_id,p_opening_date,nullif(trim(p_notes),''),(select auth.uid())); perform public.accounting_audit(p_organization_id,'opening_balance.draft_created','opening_balance_batch',v_id); return v_id; end; $$;
create or replace function public.add_opening_balance_line(p_organization_id uuid,p_batch_id uuid,p_account_id uuid,p_debit numeric,p_credit numeric,p_description text default null) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ declare v_id uuid:=gen_random_uuid(); begin perform public.assert_accounting_owner(p_organization_id); if not exists(select 1 from public.opening_balance_batches where id=p_batch_id and organization_id=p_organization_id and status='draft') or not exists(select 1 from public.accounts where id=p_account_id and organization_id=p_organization_id) then raise exception 'not_found'; end if; insert into public.opening_balance_lines(id,batch_id,account_id,debit_amount,credit_amount,description) values(v_id,p_batch_id,p_account_id,p_debit,p_credit,nullif(trim(p_description),'')); perform public.accounting_audit(p_organization_id,'opening_balance.updated','opening_balance_line',v_id); return v_id; end; $$;

do $$ declare t text; begin foreach t in array array['account_groups','accounts','cash_accounts','bank_accounts','financial_years','accounting_periods','tax_rates','document_sequences','opening_balance_batches','opening_balance_lines'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I on public.%I for select to authenticated using (public.is_active_org_member(%s))',t||'_member_select',t,case when t='opening_balance_lines' then '(select b.organization_id from public.opening_balance_batches b where b.id=batch_id)' else 'organization_id' end); end loop; end $$;
create trigger account_groups_updated before update on public.account_groups for each row execute function public.set_updated_at();
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();
create trigger cash_accounts_updated before update on public.cash_accounts for each row execute function public.set_updated_at();
create trigger bank_accounts_updated before update on public.bank_accounts for each row execute function public.set_updated_at();
create trigger financial_years_updated before update on public.financial_years for each row execute function public.set_updated_at();
create trigger accounting_periods_updated before update on public.accounting_periods for each row execute function public.set_updated_at();
create trigger tax_rates_updated before update on public.tax_rates for each row execute function public.set_updated_at();
create trigger document_sequences_updated before update on public.document_sequences for each row execute function public.set_updated_at();
create trigger opening_balance_batches_updated before update on public.opening_balance_batches for each row execute function public.set_updated_at();
create trigger opening_balance_lines_updated before update on public.opening_balance_lines for each row execute function public.set_updated_at();
revoke all on all tables in schema public from anon;
revoke all on function public.assert_accounting_owner(uuid), public.accounting_audit(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.initialize_accounting_setup(uuid,text,date,date), public.create_account(uuid,text,text,uuid,text,boolean), public.update_account(uuid,uuid,text,text,uuid,text,boolean,boolean), public.create_account_group(uuid,text,text,public.account_classification), public.create_financial_year(uuid,text,date,date,boolean), public.update_document_sequence(uuid,uuid,text,bigint,smallint,text), public.create_opening_balance_batch(uuid,uuid,date,text), public.add_opening_balance_line(uuid,uuid,uuid,numeric,numeric,text) from public, anon;
grant select on public.account_groups,public.accounts,public.cash_accounts,public.bank_accounts,public.financial_years,public.accounting_periods,public.tax_rates,public.document_sequences,public.opening_balance_batches,public.opening_balance_lines to authenticated;
grant execute on function public.initialize_accounting_setup(uuid,text,date,date), public.create_account(uuid,text,text,uuid,text,boolean), public.update_account(uuid,uuid,text,text,uuid,text,boolean,boolean), public.create_account_group(uuid,text,text,public.account_classification), public.create_financial_year(uuid,text,date,date,boolean), public.update_document_sequence(uuid,uuid,text,bigint,smallint,text), public.create_opening_balance_batch(uuid,uuid,date,text), public.add_opening_balance_line(uuid,uuid,uuid,numeric,numeric,text) to authenticated;
