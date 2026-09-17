-- FYNTA sales discount, explicit round-off and multi-leg receipt snapshots.
create extension if not exists pg_trgm;

alter table public.sales_invoice_lines add column if not exists discount_type text not null default 'fixed'
  check (discount_type in ('fixed','percentage'));
alter table public.sales_invoice_lines add column if not exists discount_value numeric(20,6) not null default 0 check(discount_value>=0);
alter table public.sales_invoice_lines add column if not exists invoice_discount_allocation numeric(20,6) not null default 0 check(invoice_discount_allocation>=0);
alter table public.sales_invoices add column if not exists invoice_discount_type text not null default 'fixed' check(invoice_discount_type in ('fixed','percentage'));
alter table public.sales_invoices add column if not exists invoice_discount_value numeric(20,6) not null default 0 check(invoice_discount_value>=0);
alter table public.sales_invoices add column if not exists invoice_discount_total numeric(20,6) not null default 0 check(invoice_discount_total>=0);
alter table public.sales_invoices add column if not exists vat_treatment text not null default 'affects_vat' check(vat_treatment in ('affects_vat','post_tax'));
alter table public.sales_invoices add column if not exists taxable_total numeric(20,6) not null default 0;
alter table public.sales_invoices add column if not exists round_off numeric(20,6) not null default 0 check(abs(round_off)<=10);

update public.sales_invoice_lines set discount_value=discount where discount_value=0 and discount<>0;
update public.sales_invoices set taxable_total=subtotal where taxable_total=0 and subtotal<>0;

alter table public.customer_receipts add column if not exists payment_mode text not null default 'cash'
  check(payment_mode in ('cash','bank_card','credit_card','split'));
create table if not exists public.customer_receipt_payment_legs(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  customer_receipt_id uuid not null references public.customer_receipts(id) on delete cascade,
  method text not null check(method in ('cash','bank_card','credit_card')),
  account_id uuid not null references public.accounts(id), amount numeric(20,6) not null check(amount>0),
  created_at timestamptz not null default now()
);
create index if not exists customer_receipt_payment_legs_receipt_idx on public.customer_receipt_payment_legs(customer_receipt_id);
alter table public.customer_receipt_payment_legs enable row level security;
create policy customer_receipt_payment_legs_member_select on public.customer_receipt_payment_legs for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy customer_receipt_payment_legs_owner_insert on public.customer_receipt_payment_legs for insert to authenticated
  with check(public.is_org_owner(organization_id));
create policy customer_receipt_payment_legs_owner_update on public.customer_receipt_payment_legs for update to authenticated
  using(public.is_org_owner(organization_id)) with check(public.is_org_owner(organization_id));
create policy customer_receipt_payment_legs_owner_delete on public.customer_receipt_payment_legs for delete to authenticated
  using(public.is_org_owner(organization_id));
grant select,insert,update,delete on public.customer_receipt_payment_legs to authenticated;

insert into public.customer_receipt_payment_legs(organization_id,customer_receipt_id,method,account_id,amount)
select r.organization_id,r.id,case when a.account_type='cash' then 'cash' else 'bank_card' end,r.cash_account_id,r.amount
from public.customer_receipts r join public.accounts a on a.id=r.cash_account_id
where not exists(select 1 from public.customer_receipt_payment_legs l where l.customer_receipt_id=r.id);
update public.customer_receipts r set payment_mode=case when a.account_type='cash' then 'cash' else 'bank_card' end
from public.accounts a where a.id=r.cash_account_id and r.payment_mode='cash' and a.account_type='bank';

create index if not exists customers_search_trgm_idx on public.customers using gin ((lower(coalesce(name,'')||' '||coalesce(phone,'')||' '||coalesce(email,''))) gin_trgm_ops);
create index if not exists suppliers_search_trgm_idx on public.suppliers using gin ((lower(coalesce(name,'')||' '||coalesce(phone,'')||' '||coalesce(email,''))) gin_trgm_ops);
create index if not exists products_search_trgm_idx on public.products using gin ((lower(coalesce(name,'')||' '||coalesce(sku,''))) gin_trgm_ops);
create index if not exists accounts_search_trgm_idx on public.accounts using gin ((lower(coalesce(name,'')||' '||coalesce(code,''))) gin_trgm_ops);

create or replace function public.replace_sales_invoice_lines(p_organization_id uuid,p_invoice_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_branch uuid; v_product public.products%rowtype; v_location uuid; v_uom record; v_type text; v_value numeric; v_discount numeric;
begin
 perform public.assert_accounting_owner(p_organization_id);
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'invoice_lines_required'; end if;
 select branch_id into v_branch from public.sales_invoices where id=p_invoice_id and organization_id=p_organization_id and status='draft' for update;
 if not found then raise exception 'invoice_not_editable'; end if;
 delete from public.sales_invoice_lines where invoice_id=p_invoice_id;
 for x in select value from jsonb_array_elements(p_lines) loop
  v_location:=null; select * into v_product from public.products where id=(x->>'product_id')::uuid and organization_id=p_organization_id and status='active';
  if not found then raise exception 'invalid_inventory_product'; end if;
  if v_product.kind='product' and v_product.track_inventory then
   if v_branch is null then raise exception 'inventory_branch_required'; end if;
   v_location:=nullif(x->>'inventory_location_id','')::uuid;
   if v_location is null then select id into v_location from public.inventory_locations where organization_id=p_organization_id and branch_id=v_branch and is_default and status='active'; end if;
   if v_location is null or not exists(select 1 from public.inventory_locations where id=v_location and organization_id=p_organization_id and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
  end if;
  select * into v_uom from public.resolve_product_uom(p_organization_id,v_product.id,nullif(x->>'transaction_unit_id','')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric);
  v_type:=coalesce(nullif(x->>'discount_type',''),'fixed'); v_value:=coalesce((x->>'discount_value')::numeric,(x->>'discount')::numeric,0);
  if v_type not in ('fixed','percentage') or v_value<0 or (v_type='percentage' and v_value>100) then raise exception 'invalid_line_discount'; end if;
  v_discount:=case when v_type='percentage' then round(v_uom.normalized_quantity*v_uom.primary_rate*v_value/100,6) else v_value end;
  if v_discount>round(v_uom.normalized_quantity*v_uom.primary_rate,6) then raise exception 'invalid_line_discount'; end if;
  insert into public.sales_invoice_lines(invoice_id,organization_id,description,quantity,unit_price,discount,discount_type,discount_value,tax_rate_id,revenue_account_id,product_id,inventory_location_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_price)
  values(p_invoice_id,p_organization_id,trim(x->>'description'),v_uom.normalized_quantity,v_uom.primary_rate,v_discount,v_type,v_value,nullif(x->>'tax_rate_id','')::uuid,nullif(x->>'revenue_account_id','')::uuid,v_product.id,v_location,(x->>'quantity')::numeric,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,(x->>'unit_price')::numeric);
 end loop;
end $$;

drop function if exists public.create_sales_invoice_draft(uuid,uuid,date,date,jsonb,uuid,text,text);
create or replace function public.create_sales_invoice_draft(p_organization_id uuid,p_customer_id uuid,p_invoice_date date,p_due_date date,p_lines jsonb,p_branch_id uuid default null,p_reference text default null,p_notes text default null,p_invoice_discount_type text default 'fixed',p_invoice_discount_value numeric default 0,p_vat_treatment text default 'affects_vat',p_round_off numeric default 0)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_id uuid:=gen_random_uuid(); begin
 perform public.assert_accounting_owner(p_organization_id);
 if p_due_date<p_invoice_date or p_invoice_discount_type not in ('fixed','percentage') or p_invoice_discount_value<0 or (p_invoice_discount_type='percentage' and p_invoice_discount_value>100) or p_vat_treatment not in ('affects_vat','post_tax') or abs(p_round_off)>10 then raise exception 'invalid_invoice'; end if;
 if not exists(select 1 from public.customers where id=p_customer_id and organization_id=p_organization_id and is_active) then raise exception 'invalid_customer'; end if;
 insert into public.sales_invoices(id,organization_id,branch_id,customer_id,invoice_date,due_date,reference,notes,created_by,invoice_discount_type,invoice_discount_value,vat_treatment,round_off)
 values(v_id,p_organization_id,p_branch_id,p_customer_id,p_invoice_date,p_due_date,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid(),p_invoice_discount_type,p_invoice_discount_value,p_vat_treatment,p_round_off);
 perform public.replace_sales_invoice_lines(p_organization_id,v_id,p_lines); perform public.accounting_audit(p_organization_id,'sales_invoice.created','sales_invoice',v_id); return v_id; end $$;

drop function if exists public.update_sales_invoice_draft(uuid,uuid,uuid,date,date,jsonb,uuid,text,text);
create or replace function public.update_sales_invoice_draft(p_organization_id uuid,p_invoice_id uuid,p_customer_id uuid,p_invoice_date date,p_due_date date,p_lines jsonb,p_branch_id uuid default null,p_reference text default null,p_notes text default null,p_invoice_discount_type text default 'fixed',p_invoice_discount_value numeric default 0,p_vat_treatment text default 'affects_vat',p_round_off numeric default 0)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 perform public.assert_accounting_owner(p_organization_id);
 if p_due_date<p_invoice_date or p_invoice_discount_type not in ('fixed','percentage') or p_invoice_discount_value<0 or (p_invoice_discount_type='percentage' and p_invoice_discount_value>100) or p_vat_treatment not in ('affects_vat','post_tax') or abs(p_round_off)>10 then raise exception 'invalid_invoice'; end if;
 update public.sales_invoices set customer_id=p_customer_id,invoice_date=p_invoice_date,due_date=p_due_date,branch_id=p_branch_id,reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),''),invoice_discount_type=p_invoice_discount_type,invoice_discount_value=p_invoice_discount_value,vat_treatment=p_vat_treatment,round_off=p_round_off where id=p_invoice_id and organization_id=p_organization_id and status='draft';
 if not found then raise exception 'invoice_not_editable'; end if; perform public.replace_sales_invoice_lines(p_organization_id,p_invoice_id,p_lines); perform public.accounting_audit(p_organization_id,'sales_invoice.updated','sales_invoice',p_invoice_id); end $$;

create or replace function public.post_sales_invoice(p_organization_id uuid,p_invoice_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.sales_invoices%rowtype; l public.sales_invoice_lines%rowtype; v_journal uuid:=gen_random_uuid(); v_ar uuid; v_revenue uuid; v_output_vat uuid; v_round_account uuid; v_account uuid; v_tax public.tax_rates%rowtype; v_net numeric:=0; v_posted_net numeric; v_tax_amount numeric; v_net_total numeric:=0; v_discount_total numeric:=0; v_alloc numeric; v_allocated numeric:=0; v_taxable numeric:=0; v_tax_total numeric:=0; v_grand numeric; v_number bigint; v_prefix text; v_padding smallint; v_suffix text; v_line_number smallint:=0; v_idx int:=0; v_count int;
begin
 perform public.assert_accounting_owner(p_organization_id); select * into d from public.sales_invoices where id=p_invoice_id and organization_id=p_organization_id for update;
 if not found then raise exception 'not_found'; end if; if d.status='posted' then return jsonb_build_object('invoice_id',d.id,'journal_id',d.posted_journal_id,'invoice_number',d.invoice_number,'already_posted',true); end if;
 select id into v_ar from public.accounts where organization_id=p_organization_id and system_key='accounts_receivable' and is_active; select id into v_revenue from public.accounts where organization_id=p_organization_id and system_key='sales_revenue' and is_active; select id into v_output_vat from public.accounts where organization_id=p_organization_id and system_key='output_vat' and is_active;
 select id into v_round_account from public.accounts where organization_id=p_organization_id and system_key='round_off_adjustment' and is_active;
 if v_round_account is null then insert into public.accounts(organization_id,account_group_id,code,name,account_type,system_key,is_system,allow_manual_posting) select p_organization_id,id,'6990','Round Off Adjustments','expense','round_off_adjustment',true,false from public.account_groups where organization_id=p_organization_id and system_key='operating_expenses' on conflict(organization_id,system_key) do nothing; select id into v_round_account from public.accounts where organization_id=p_organization_id and system_key='round_off_adjustment' and is_active; end if;
 if v_ar is null or v_revenue is null or v_output_vat is null or v_round_account is null then raise exception 'system_account_missing'; end if;
 select coalesce(sum(round(quantity*unit_price-discount,6)),0),count(*) into v_net_total,v_count from public.sales_invoice_lines where invoice_id=d.id;
 if v_count=0 then raise exception 'invoice_lines_required'; end if;
 v_discount_total:=case when d.invoice_discount_type='percentage' then round(v_net_total*d.invoice_discount_value/100,6) else d.invoice_discount_value end;
 if v_discount_total<0 or v_discount_total>v_net_total then raise exception 'invalid_invoice_discount'; end if;
 insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,description,created_by) values(v_journal,p_organization_id,d.branch_id,d.invoice_date,'sales_invoice',d.id,'Sales invoice',auth.uid());
 for l in select * from public.sales_invoice_lines where invoice_id=d.id order by id loop
  v_idx:=v_idx+1; v_net:=round(l.quantity*l.unit_price-l.discount,6); v_alloc:=case when v_idx=v_count then v_discount_total-v_allocated when v_net_total=0 then 0 else round(v_discount_total*v_net/v_net_total,6) end; v_allocated:=v_allocated+v_alloc;
  update public.sales_invoice_lines set invoice_discount_allocation=v_alloc where id=l.id;
  v_posted_net:=case when d.vat_treatment='affects_vat' then v_net-v_alloc else v_net end; v_account:=coalesce(l.revenue_account_id,v_revenue);
  if not exists(select 1 from public.accounts where id=v_account and organization_id=p_organization_id and is_active) then raise exception 'invalid_revenue_account'; end if;
  v_tax_amount:=0; if l.tax_rate_id is not null then select * into v_tax from public.tax_rates where id=l.tax_rate_id and organization_id=p_organization_id and sales_enabled and is_active; if not found then raise exception 'invalid_sales_tax_rate'; end if; v_tax_amount:=round(v_posted_net*v_tax.rate_percent/100,6); end if;
  v_taxable:=v_taxable+v_posted_net; v_tax_total:=v_tax_total+v_tax_amount; v_line_number:=v_line_number+1;
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,tax_rate_id,tax_amount,party_type,party_id,branch_id) values(p_organization_id,v_journal,v_line_number,v_account,l.description,0,v_posted_net,l.tax_rate_id,v_tax_amount,'customer',d.customer_id,d.branch_id);
  if v_tax_amount<>0 then v_line_number:=v_line_number+1; insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,tax_rate_id,tax_amount,party_type,party_id,branch_id) values(p_organization_id,v_journal,v_line_number,v_output_vat,'VAT: '||l.description,0,v_tax_amount,l.tax_rate_id,v_tax_amount,'customer',d.customer_id,d.branch_id); end if;
 end loop;
 if d.vat_treatment='post_tax' and v_discount_total<>0 then v_line_number:=v_line_number+1; insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,v_line_number,v_round_account,'Post-tax invoice discount',v_discount_total,0,d.branch_id); end if;
 if d.round_off<>0 then v_line_number:=v_line_number+1; insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,v_line_number,v_round_account,'Invoice round off',case when d.round_off<0 then -d.round_off else 0 end,case when d.round_off>0 then d.round_off else 0 end,d.branch_id); end if;
 v_grand:=round(v_taxable+v_tax_total-(case when d.vat_treatment='post_tax' then v_discount_total else 0 end)+d.round_off,6);
 select prefix,padding,suffix,next_number into v_prefix,v_padding,v_suffix,v_number from public.document_sequences where organization_id=p_organization_id and document_type='sales_invoice' and branch_id is null and financial_year_id is null for update;
 update public.document_sequences set next_number=next_number+1 where organization_id=p_organization_id and document_type='sales_invoice' and branch_id is null and financial_year_id is null;
 update public.journal_entries set reference=v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,'') where id=v_journal; v_line_number:=v_line_number+1;
 insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,party_type,party_id,branch_id) values(p_organization_id,v_journal,v_line_number,v_ar,'Accounts receivable',v_grand,0,'customer',d.customer_id,d.branch_id);
 perform public.post_journal_entry(p_organization_id,v_journal);
 update public.sales_invoices set invoice_number=v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,''),subtotal=v_net_total,invoice_discount_total=v_discount_total,taxable_total=v_taxable,tax_total=v_tax_total,grand_total=v_grand,status='posted',posted_journal_id=v_journal,posted_at=now(),posted_by=auth.uid() where id=d.id;
 insert into public.open_items(organization_id,kind,customer_id,source_journal_id,source_document_id,original_amount,remaining_amount,due_date) values(p_organization_id,'receivable',d.customer_id,v_journal,d.id,v_grand,v_grand,d.due_date);
 perform public.accounting_audit(p_organization_id,'sales_invoice.posted','sales_invoice',d.id,jsonb_build_object('journal_id',v_journal)); return jsonb_build_object('invoice_id',d.id,'journal_id',v_journal,'invoice_number',v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,''),'already_posted',false);
end $$;

create or replace function public.replace_customer_receipt_legs(p_organization_id uuid,p_receipt_id uuid,p_payment_mode text,p_payment_legs jsonb,p_amount numeric) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_total numeric:=0; v_method text; v_account uuid; v_leg_amount numeric; begin
 perform public.assert_accounting_owner(p_organization_id); if p_payment_mode not in ('cash','bank_card','credit_card','split') or jsonb_typeof(p_payment_legs)<>'array' or jsonb_array_length(p_payment_legs)=0 then raise exception 'invalid_payment_legs'; end if;
 delete from public.customer_receipt_payment_legs where customer_receipt_id=p_receipt_id;
 for x in select value from jsonb_array_elements(p_payment_legs) loop v_method:=x->>'method';v_account:=(x->>'account_id')::uuid;v_leg_amount:=(x->>'amount')::numeric;
  if v_method not in ('cash','bank_card','credit_card') or v_leg_amount<=0 or not exists(select 1 from public.accounts where id=v_account and organization_id=p_organization_id and is_active and account_type=case when v_method='cash' then 'cash' else 'bank' end) then raise exception 'invalid_payment_leg'; end if;
  insert into public.customer_receipt_payment_legs(organization_id,customer_receipt_id,method,account_id,amount) values(p_organization_id,p_receipt_id,v_method,v_account,v_leg_amount);v_total:=v_total+v_leg_amount;
 end loop; if round(v_total,6)<>round(p_amount,6) then raise exception 'payment_legs_must_equal_amount'; end if;
 if p_payment_mode<>'split' and jsonb_array_length(p_payment_legs)<>1 then raise exception 'invalid_payment_legs'; end if;
 update public.customer_receipts set payment_mode=p_payment_mode,cash_account_id=(select account_id from public.customer_receipt_payment_legs where customer_receipt_id=p_receipt_id order by created_at,id limit 1) where id=p_receipt_id;
end $$;

drop function if exists public.create_customer_receipt_draft(uuid,uuid,date,uuid,numeric,jsonb,uuid,text,text);
create or replace function public.create_customer_receipt_draft(p_organization_id uuid,p_customer_id uuid,p_receipt_date date,p_cash_account_id uuid,p_amount numeric,p_allocations jsonb default '[]'::jsonb,p_branch_id uuid default null,p_reference text default null,p_notes text default null,p_payment_mode text default 'cash',p_payment_legs jsonb default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_id uuid:=gen_random_uuid();v_legs jsonb; begin
 perform public.assert_accounting_owner(p_organization_id); if p_amount<=0 or not exists(select 1 from public.customers where id=p_customer_id and organization_id=p_organization_id and is_active) then raise exception 'invalid_receipt'; end if;
 insert into public.customer_receipts(id,organization_id,branch_id,customer_id,receipt_date,cash_account_id,amount,payment_mode,reference,notes,created_by) values(v_id,p_organization_id,p_branch_id,p_customer_id,p_receipt_date,p_cash_account_id,p_amount,p_payment_mode,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
 v_legs:=coalesce(p_payment_legs,jsonb_build_array(jsonb_build_object('method',case when p_payment_mode='cash' then 'cash' else 'bank_card' end,'account_id',p_cash_account_id,'amount',p_amount))); perform public.replace_customer_receipt_legs(p_organization_id,v_id,p_payment_mode,v_legs,p_amount); perform public.accounting_audit(p_organization_id,'customer_receipt.created','customer_receipt',v_id); return v_id; end $$;

drop function if exists public.update_customer_receipt_draft(uuid,uuid,uuid,date,uuid,numeric,uuid,text,text);
create or replace function public.update_customer_receipt_draft(p_organization_id uuid,p_receipt_id uuid,p_customer_id uuid,p_receipt_date date,p_cash_account_id uuid,p_amount numeric,p_branch_id uuid default null,p_reference text default null,p_notes text default null,p_payment_mode text default 'cash',p_payment_legs jsonb default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_legs jsonb;begin
 perform public.assert_accounting_owner(p_organization_id); update public.customer_receipts set customer_id=p_customer_id,receipt_date=p_receipt_date,amount=p_amount,branch_id=p_branch_id,reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),'') where id=p_receipt_id and organization_id=p_organization_id and status='draft'; if not found then raise exception 'receipt_not_editable'; end if;
 v_legs:=coalesce(p_payment_legs,jsonb_build_array(jsonb_build_object('method',case when p_payment_mode='cash' then 'cash' else 'bank_card' end,'account_id',p_cash_account_id,'amount',p_amount)));perform public.replace_customer_receipt_legs(p_organization_id,p_receipt_id,p_payment_mode,v_legs,p_amount);perform public.accounting_audit(p_organization_id,'customer_receipt.updated','customer_receipt',p_receipt_id);end $$;

create or replace function public.post_customer_receipt(p_organization_id uuid,p_receipt_id uuid,p_allocations jsonb default '[]'::jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.customer_receipts%rowtype;x jsonb;i public.open_items%rowtype;l public.customer_receipt_payment_legs%rowtype;v_total numeric:=0;v_leg_total numeric:=0;v_amount numeric;v_journal uuid:=gen_random_uuid();v_ar uuid;v_n bigint;v_prefix text;v_padding smallint;v_suffix text;v_line smallint:=0;begin
 perform public.assert_accounting_owner(p_organization_id);perform public.assert_unique_settlement_allocation_targets(p_organization_id,p_allocations);select * into d from public.customer_receipts where id=p_receipt_id and organization_id=p_organization_id for update;if not found then raise exception 'not_found';end if;if d.status='posted' then return jsonb_build_object('receipt_id',d.id,'journal_id',d.posted_journal_id,'already_posted',true);end if;
 for x in select value from jsonb_array_elements(p_allocations) loop v_amount:=(x->>'amount')::numeric;select * into i from public.open_items where id=(x->>'open_item_id')::uuid and organization_id=p_organization_id for update;if not found or i.kind<>'receivable' or i.customer_id<>d.customer_id or v_amount<=0 or v_amount>i.remaining_amount then raise exception 'invalid_receipt_allocation';end if;v_total:=v_total+v_amount;end loop;if round(v_total,6)<>round(d.amount,6) then raise exception 'receipt_allocation_must_equal_amount';end if;
 select id into v_ar from public.accounts where organization_id=p_organization_id and system_key='accounts_receivable' and is_active;if v_ar is null then raise exception 'system_account_missing';end if;
 insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,description,created_by) values(v_journal,p_organization_id,d.branch_id,d.receipt_date,'customer_receipt',d.id,'Customer receipt',auth.uid());
 for l in select * from public.customer_receipt_payment_legs where customer_receipt_id=d.id order by created_at,id loop v_leg_total:=v_leg_total+l.amount;v_line:=v_line+1;insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,v_line,l.account_id,'Customer receipt · '||replace(l.method,'_',' '),l.amount,0,d.branch_id);end loop;
 if round(v_leg_total,6)<>round(d.amount,6) then raise exception 'payment_legs_must_equal_amount';end if;v_line:=v_line+1;insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,party_type,party_id,branch_id) values(p_organization_id,v_journal,v_line,v_ar,'Accounts receivable',0,d.amount,'customer',d.customer_id,d.branch_id);
 select prefix,padding,suffix,next_number into v_prefix,v_padding,v_suffix,v_n from public.document_sequences where organization_id=p_organization_id and document_type='receipt' and branch_id is null and financial_year_id is null for update;update public.document_sequences set next_number=next_number+1 where organization_id=p_organization_id and document_type='receipt' and branch_id is null and financial_year_id is null;update public.journal_entries set reference=v_prefix||lpad(v_n::text,v_padding,'0')||coalesce(v_suffix,'') where id=v_journal;perform public.post_journal_entry(p_organization_id,v_journal);
 for x in select value from jsonb_array_elements(p_allocations) loop v_amount:=(x->>'amount')::numeric;update public.open_items set remaining_amount=remaining_amount-v_amount,status=case when remaining_amount-v_amount=0 then 'settled' else 'partial' end where id=(x->>'open_item_id')::uuid;insert into public.open_item_allocations(organization_id,open_item_id,customer_receipt_id,amount) values(p_organization_id,(x->>'open_item_id')::uuid,d.id,v_amount);end loop;
 update public.customer_receipts set receipt_number=v_prefix||lpad(v_n::text,v_padding,'0')||coalesce(v_suffix,''),status='posted',posted_journal_id=v_journal,posted_at=now(),posted_by=auth.uid() where id=d.id;perform public.accounting_audit(p_organization_id,'customer_receipt.posted','customer_receipt',d.id);return jsonb_build_object('receipt_id',d.id,'journal_id',v_journal,'already_posted',false);
end $$;

revoke all on function public.replace_customer_receipt_legs(uuid,uuid,text,jsonb,numeric) from public,anon;
grant execute on function public.replace_customer_receipt_legs(uuid,uuid,text,jsonb,numeric) to authenticated;
