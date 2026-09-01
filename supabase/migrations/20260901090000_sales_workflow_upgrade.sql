-- Quotations and delivery notes are operational source documents. Sales invoices
-- remain the sole accounting/inventory posting document, preventing duplicate COGS.
create type public.conversion_source_type as enum ('quotation','delivery_note');
create type public.conversion_target_type as enum ('delivery_note','sales_invoice');

create table public.sales_quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  customer_id uuid not null references public.customers(id),
  quotation_number text not null,
  quotation_date date not null,
  expiry_date date not null,
  reference text,
  notes text,
  status public.entity_status not null default 'active',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quotation_number),
  check (expiry_date >= quotation_date)
);
create table public.sales_quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.sales_quotations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id),
  description text not null,
  quantity numeric(20,6) not null check (quantity > 0),
  unit_price numeric(20,6) not null check (unit_price >= 0),
  discount numeric(20,6) not null default 0 check (discount >= 0),
  tax_rate_id uuid references public.tax_rates(id),
  revenue_account_id uuid not null references public.accounts(id),
  created_at timestamptz not null default now()
);
create table public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  customer_id uuid not null references public.customers(id),
  delivery_note_number text not null,
  delivery_date date not null,
  reference text,
  notes text,
  status public.entity_status not null default 'active',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, delivery_note_number)
);
create table public.delivery_note_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.delivery_notes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id),
  description text not null,
  quantity numeric(20,6) not null check (quantity > 0),
  unit_price numeric(20,6) not null check (unit_price >= 0),
  discount numeric(20,6) not null default 0 check (discount >= 0),
  tax_rate_id uuid references public.tax_rates(id),
  revenue_account_id uuid not null references public.accounts(id),
  created_at timestamptz not null default now()
);

-- One row per consumed source line. Manual target lines deliberately have no row.
create table public.document_conversion_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type public.conversion_source_type not null,
  source_document_id uuid not null,
  source_line_id uuid not null,
  target_type public.conversion_target_type not null,
  target_document_id uuid not null,
  target_line_id uuid,
  quantity numeric(20,6) not null check (quantity > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (source_type, source_line_id, target_type, target_document_id, target_line_id)
);
create index document_conversion_source_idx on public.document_conversion_lines(organization_id,source_type,source_document_id);
create index document_conversion_target_idx on public.document_conversion_lines(organization_id,target_type,target_document_id);
create index quotation_filter_idx on public.sales_quotations(organization_id,quotation_date,customer_id,branch_id);
create index quotation_line_product_idx on public.sales_quotation_lines(organization_id,product_id,quotation_id);
create index delivery_filter_idx on public.delivery_notes(organization_id,delivery_date,customer_id,branch_id);
create index delivery_line_product_idx on public.delivery_note_lines(organization_id,product_id,delivery_note_id);
create index invoice_filter_idx on public.sales_invoices(organization_id,invoice_date,customer_id,branch_id);
create index invoice_line_product_idx on public.sales_invoice_lines(organization_id,product_id,invoice_id);
create index bill_filter_idx on public.purchase_bills(organization_id,bill_date,supplier_id,branch_id);
create index bill_line_product_idx on public.purchase_bill_lines(organization_id,product_id,bill_id);

alter table public.sales_quotations enable row level security;
alter table public.sales_quotation_lines enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;
alter table public.document_conversion_lines enable row level security;
create policy quotations_select on public.sales_quotations for select to authenticated using (public.has_org_capability(organization_id,'accounting.read'));
create policy quotation_lines_select on public.sales_quotation_lines for select to authenticated using (public.has_org_capability(organization_id,'accounting.read'));
create policy delivery_notes_select on public.delivery_notes for select to authenticated using (public.has_org_capability(organization_id,'accounting.read'));
create policy delivery_note_lines_select on public.delivery_note_lines for select to authenticated using (public.has_org_capability(organization_id,'accounting.read'));
create policy conversion_lines_select on public.document_conversion_lines for select to authenticated using (public.has_org_capability(organization_id,'accounting.read'));

create trigger quotations_updated before update on public.sales_quotations for each row execute function public.set_updated_at();
create trigger delivery_notes_updated before update on public.delivery_notes for each row execute function public.set_updated_at();

create or replace function public.next_operational_document_number(p_org uuid,p_prefix text,p_table regclass,p_column name)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_year text:=extract(year from current_date)::text; v_count bigint; v_sql text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_prefix,0));
  v_sql:=format('select count(*) from %s where organization_id=$1 and %I like $2',p_table,p_column);
  execute v_sql into v_count using p_org,p_prefix||'-'||v_year||'-%';
  return p_prefix||'-'||v_year||'-'||lpad((v_count+1)::text,4,'0');
end $$;

create or replace function public.source_line_remaining(p_org uuid,p_type public.conversion_source_type,p_line uuid)
returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
  select greatest(0,coalesce(
    case when p_type='quotation' then (select quantity from public.sales_quotation_lines where id=p_line and organization_id=p_org)
         else (select quantity from public.delivery_note_lines where id=p_line and organization_id=p_org) end,0)
    - coalesce((select sum(quantity) from public.document_conversion_lines where organization_id=p_org and source_type=p_type and source_line_id=p_line),0));
$$;

create or replace function public.save_operational_document(
 p_org uuid,p_kind text,p_id uuid,p_customer uuid,p_branch uuid,p_date date,p_expiry date,p_reference text,p_notes text,p_lines jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); x jsonb; v_number text;
begin
 perform public.assert_accounting_owner(p_org);
 if p_kind not in ('quotation','delivery_note') or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'invalid_operational_document'; end if;
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active)
    or not exists(select 1 from public.branches where id=p_branch and organization_id=p_org and status='active') then raise exception 'invalid_operational_context'; end if;
 if p_kind='quotation' then
   if p_expiry is null or p_expiry<p_date then raise exception 'invalid_expiry'; end if;
   if p_id is null then
     v_number:=public.next_operational_document_number(p_org,'QT','public.sales_quotations','quotation_number');
     insert into public.sales_quotations(id,organization_id,branch_id,customer_id,quotation_number,quotation_date,expiry_date,reference,notes,created_by)
     values(v_id,p_org,p_branch,p_customer,v_number,p_date,p_expiry,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
   else
     if exists(select 1 from public.document_conversion_lines where organization_id=p_org and source_type='quotation' and source_document_id=p_id) then raise exception 'converted_document_not_editable'; end if;
     update public.sales_quotations set branch_id=p_branch,customer_id=p_customer,quotation_date=p_date,expiry_date=p_expiry,reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),'') where id=p_id and organization_id=p_org;
     if not found then raise exception 'quotation_not_found'; end if; delete from public.sales_quotation_lines where quotation_id=p_id;
   end if;
   for x in select value from jsonb_array_elements(p_lines) loop
     insert into public.sales_quotation_lines(quotation_id,organization_id,product_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id)
     values(v_id,p_org,(x->>'product_id')::uuid,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'revenue_account_id')::uuid);
   end loop;
 else
   if p_id is null then
     v_number:=public.next_operational_document_number(p_org,'DN','public.delivery_notes','delivery_note_number');
     insert into public.delivery_notes(id,organization_id,branch_id,customer_id,delivery_note_number,delivery_date,reference,notes,created_by)
     values(v_id,p_org,p_branch,p_customer,v_number,p_date,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
   else
     if exists(select 1 from public.document_conversion_lines where organization_id=p_org and source_type='delivery_note' and source_document_id=p_id) then raise exception 'converted_document_not_editable'; end if;
     update public.delivery_notes set branch_id=p_branch,customer_id=p_customer,delivery_date=p_date,reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),'') where id=p_id and organization_id=p_org;
     if not found then raise exception 'delivery_note_not_found'; end if; delete from public.delivery_note_lines where delivery_note_id=p_id;
   end if;
   for x in select value from jsonb_array_elements(p_lines) loop
     insert into public.delivery_note_lines(delivery_note_id,organization_id,product_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id)
     values(v_id,p_org,(x->>'product_id')::uuid,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'revenue_account_id')::uuid);
   end loop;
 end if;
 perform public.accounting_audit(p_org,p_kind||'.saved',p_kind,v_id,jsonb_build_object('non_posting',true)); return v_id;
end $$;

create or replace function public.record_document_conversions(p_org uuid,p_target_type public.conversion_target_type,p_target_id uuid,p_allocations jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_source_type public.conversion_source_type; v_source_doc uuid; v_source_line uuid; v_qty numeric; v_remaining numeric; v_customer uuid; v_branch uuid; v_target_customer uuid; v_target_branch uuid;
begin
 perform public.assert_accounting_owner(p_org);
 if jsonb_typeof(p_allocations)<>'array' then raise exception 'invalid_allocations'; end if;
 if p_target_type='sales_invoice' then select customer_id,branch_id into v_target_customer,v_target_branch from public.sales_invoices where id=p_target_id and organization_id=p_org and status='draft';
 else select customer_id,branch_id into v_target_customer,v_target_branch from public.delivery_notes where id=p_target_id and organization_id=p_org; end if;
 if v_target_customer is null then raise exception 'target_not_editable'; end if;
 delete from public.document_conversion_lines where organization_id=p_org and target_type=p_target_type and target_document_id=p_target_id;
 for x in select value from jsonb_array_elements(p_allocations) loop
   v_source_type:=(x->>'source_type')::public.conversion_source_type; v_source_doc:=(x->>'source_document_id')::uuid; v_source_line:=(x->>'source_line_id')::uuid; v_qty:=(x->>'quantity')::numeric;
   if v_source_type='quotation' then select customer_id,branch_id into v_customer,v_branch from public.sales_quotations where id=v_source_doc and organization_id=p_org;
   else select customer_id,branch_id into v_customer,v_branch from public.delivery_notes where id=v_source_doc and organization_id=p_org; end if;
   if v_customer is distinct from v_target_customer or v_branch is distinct from v_target_branch then raise exception 'incompatible_source_documents'; end if;
   v_remaining:=public.source_line_remaining(p_org,v_source_type,v_source_line);
   if v_qty<=0 or v_qty>v_remaining then raise exception 'over_conversion: remaining % requested %',v_remaining,v_qty; end if;
   insert into public.document_conversion_lines(organization_id,source_type,source_document_id,source_line_id,target_type,target_document_id,quantity,created_by)
   values(p_org,v_source_type,v_source_doc,v_source_line,p_target_type,p_target_id,v_qty,auth.uid());
 end loop;
 perform public.accounting_audit(p_org,'document.conversion_recorded',p_target_type::text,p_target_id,jsonb_build_object('allocations',p_allocations));
end $$;

grant select on public.sales_quotations,public.sales_quotation_lines,public.delivery_notes,public.delivery_note_lines,public.document_conversion_lines to authenticated;
revoke all on function public.next_operational_document_number(uuid,text,regclass,name),public.source_line_remaining(uuid,public.conversion_source_type,uuid),public.save_operational_document(uuid,text,uuid,uuid,uuid,date,date,text,text,jsonb),public.record_document_conversions(uuid,public.conversion_target_type,uuid,jsonb) from public,anon;
grant execute on function public.source_line_remaining(uuid,public.conversion_source_type,uuid),public.save_operational_document(uuid,text,uuid,uuid,uuid,date,date,text,text,jsonb),public.record_document_conversions(uuid,public.conversion_target_type,uuid,jsonb) to authenticated;

-- KG is already seeded by initialize_inventory_foundation alongside every other
-- unit. Keeping that shared initializer is what makes KG available everywhere.
