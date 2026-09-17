-- Configurable units of measure. Existing quantity/unit_price columns remain the
-- authoritative primary-unit representation so every existing posting and
-- costing function continues to operate unchanged. Entered values are immutable
-- snapshots used for document display and audit.

alter table public.products
  add column secondary_unit_id uuid references public.inventory_units(id),
  add column secondary_conversion_factor numeric(24,12),
  add constraint products_secondary_uom_complete check (
    (secondary_unit_id is null and secondary_conversion_factor is null) or
    (secondary_unit_id is not null and secondary_conversion_factor > 0 and secondary_conversion_factor <= 1000000000)
  ),
  add constraint products_distinct_uoms check (secondary_unit_id is null or secondary_unit_id <> unit_id);

create index products_secondary_unit_idx on public.products(organization_id,secondary_unit_id)
  where secondary_unit_id is not null;

do $$
declare v_table text;
begin
  foreach v_table in array array['sales_invoice_lines','purchase_bill_lines','sales_quotation_lines','delivery_note_lines'] loop
    execute format('alter table public.%I add column transaction_quantity numeric(24,12), add column transaction_unit_id uuid references public.inventory_units(id), add column transaction_unit_code text, add column transaction_unit_name text, add column conversion_factor numeric(24,12), add column transaction_unit_price numeric(24,12)',v_table);
    execute format('alter table public.%I add constraint %I check (transaction_quantity is null or transaction_quantity > 0)',v_table,v_table||'_transaction_quantity_check');
    execute format('alter table public.%I add constraint %I check (conversion_factor is null or conversion_factor > 0)',v_table,v_table||'_conversion_factor_check');
  end loop;
end $$;

update public.sales_invoice_lines l set
  transaction_quantity=l.quantity, transaction_unit_id=p.unit_id,
  transaction_unit_code=u.code, transaction_unit_name=u.name,
  conversion_factor=1, transaction_unit_price=l.unit_price
from public.products p left join public.inventory_units u on u.id=p.unit_id
where p.id=l.product_id;
update public.purchase_bill_lines l set
  transaction_quantity=l.quantity, transaction_unit_id=p.unit_id,
  transaction_unit_code=u.code, transaction_unit_name=u.name,
  conversion_factor=1, transaction_unit_price=l.unit_price
from public.products p left join public.inventory_units u on u.id=p.unit_id
where p.id=l.product_id;
update public.sales_quotation_lines l set
  transaction_quantity=l.quantity, transaction_unit_id=p.unit_id,
  transaction_unit_code=u.code, transaction_unit_name=u.name,
  conversion_factor=1, transaction_unit_price=l.unit_price
from public.products p left join public.inventory_units u on u.id=p.unit_id
where p.id=l.product_id;
update public.delivery_note_lines l set
  transaction_quantity=l.quantity, transaction_unit_id=p.unit_id,
  transaction_unit_code=u.code, transaction_unit_name=u.name,
  conversion_factor=1, transaction_unit_price=l.unit_price
from public.products p left join public.inventory_units u on u.id=p.unit_id
where p.id=l.product_id;

create table public.stock_operation_uom_details (
  operation_id uuid primary key references public.stock_operations(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_quantity numeric(24,12) not null check(transaction_quantity>0),
  transaction_unit_id uuid not null references public.inventory_units(id),
  transaction_unit_code text not null,
  transaction_unit_name text not null,
  conversion_factor numeric(24,12) not null check(conversion_factor>0),
  transaction_unit_cost numeric(24,12),
  created_at timestamptz not null default now()
);
create index stock_operation_uom_org_idx on public.stock_operation_uom_details(organization_id);
create index stock_operation_uom_unit_idx on public.stock_operation_uom_details(transaction_unit_id);
alter table public.stock_operation_uom_details enable row level security;
create policy stock_operation_uom_select on public.stock_operation_uom_details for select to authenticated
  using(public.has_org_capability(organization_id,'reports.view'));
revoke all on public.stock_operation_uom_details from public,anon;
grant select on public.stock_operation_uom_details to authenticated;

create or replace function public.ensure_default_inventory_units(p_org uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x record;
begin
  if not public.is_active_org_member(p_org) then raise exception 'not_authorized'; end if;
  for x in select * from (values
    ('UNIT','Unit'),('PCS','Pieces'),('BOX','Box'),('PKT','Packet'),('BAG','Bag'),
    ('SET','Set'),('PAIR','Pair'),('DOZ','Dozen'),('KG','Kilogram'),('G','Gram'),
    ('TON','Ton'),('M','Meter'),('CM','Centimeter'),('SQM','Square Meter'),
    ('L','Liter'),('ML','Milliliter'),('BTL','Bottle'),('ROLL','Roll'),
    ('HR','Hour'),('DAY','Day'),('JOB','Job'),('SRV','Service')
  ) as d(code,name) loop
    insert into public.inventory_units(organization_id,code,name,created_by)
    values(p_org,x.code,x.name,auth.uid()) on conflict(organization_id,code) do nothing;
  end loop;
end $$;

create or replace function public.save_inventory_unit(p_org uuid,p_id uuid,p_name text,p_code text,p_status public.entity_status)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); v_name text:=trim(p_name); v_code text:=upper(trim(p_code));
begin
  perform public.assert_org_capability(p_org,'inventory.manage');
  if v_name='' or v_code='' or length(v_name)>80 or length(v_code)>16 then raise exception 'invalid_unit'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-unit:'||p_org::text,0));
  if exists(select 1 from public.inventory_units where organization_id=p_org and id<>v_id and (lower(trim(name))=lower(v_name) or lower(trim(code))=lower(v_code))) then raise exception 'duplicate_unit'; end if;
  if p_id is null then
    insert into public.inventory_units(id,organization_id,code,name,status,created_by) values(v_id,p_org,v_code,v_name,p_status,auth.uid());
  else
    update public.inventory_units set code=v_code,name=v_name,status=p_status where id=p_id and organization_id=p_org;
    if not found then raise exception 'unit_not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.resolve_product_uom(
  p_org uuid,p_product uuid,p_unit uuid,p_transaction_quantity numeric,p_transaction_rate numeric
) returns table(normalized_quantity numeric,primary_rate numeric,unit_id uuid,unit_code text,unit_name text,factor numeric)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.products%rowtype; u public.inventory_units%rowtype; v_unit uuid; v_factor numeric;
begin
  if p_transaction_quantity<=0 or p_transaction_rate<0 then raise exception 'invalid_uom_values'; end if;
  select * into p from public.products where id=p_product and organization_id=p_org and status='active';
  if not found then raise exception 'invalid_inventory_product'; end if;
  v_unit:=coalesce(p_unit,p.unit_id);
  if v_unit is null then
    return query select p_transaction_quantity,p_transaction_rate,null::uuid,null::text,null::text,1::numeric; return;
  elsif v_unit=p.unit_id then v_factor:=1;
  elsif v_unit=p.secondary_unit_id and p.secondary_conversion_factor is not null then v_factor:=p.secondary_conversion_factor;
  else raise exception 'invalid_product_unit';
  end if;
  select * into u from public.inventory_units where id=v_unit and organization_id=p_org;
  if not found then raise exception 'invalid_product_unit'; end if;
  return query select round(p_transaction_quantity/v_factor,12),round(p_transaction_rate*v_factor,12),u.id,u.code,u.name,v_factor;
end $$;

create or replace function public.replace_sales_invoice_lines(p_organization_id uuid,p_invoice_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_branch uuid; v_product public.products%rowtype; v_location uuid; v_uom record;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'invoice_lines_required'; end if;
  select branch_id into v_branch from public.sales_invoices where id=p_invoice_id and organization_id=p_organization_id and status='draft' for update;
  if not found then raise exception 'invoice_not_editable'; end if;
  delete from public.sales_invoice_lines where invoice_id=p_invoice_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    v_location:=null;
    select * into v_product from public.products where id=(x->>'product_id')::uuid and organization_id=p_organization_id and status='active';
    if not found then raise exception 'invalid_inventory_product'; end if;
    if v_product.kind='product' and v_product.track_inventory then
      if v_branch is null then raise exception 'inventory_branch_required'; end if;
      v_location:=nullif(x->>'inventory_location_id','')::uuid;
      if v_location is null then select id into v_location from public.inventory_locations where organization_id=p_organization_id and branch_id=v_branch and is_default and status='active'; end if;
      if v_location is null or not exists(select 1 from public.inventory_locations where id=v_location and organization_id=p_organization_id and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
    end if;
    select * into v_uom from public.resolve_product_uom(p_organization_id,v_product.id,nullif(x->>'transaction_unit_id','')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric);
    insert into public.sales_invoice_lines(invoice_id,organization_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,product_id,inventory_location_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_price)
    values(p_invoice_id,p_organization_id,trim(x->>'description'),v_uom.normalized_quantity,v_uom.primary_rate,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,nullif(x->>'revenue_account_id','')::uuid,v_product.id,v_location,(x->>'quantity')::numeric,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,(x->>'unit_price')::numeric);
  end loop;
end $$;

create or replace function public.replace_purchase_bill_lines(p_organization_id uuid,p_bill_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_branch uuid; v_product public.products%rowtype; v_location uuid; v_uom record;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'bill_lines_required'; end if;
  select branch_id into v_branch from public.purchase_bills where id=p_bill_id and organization_id=p_organization_id and status='draft' for update;
  if not found then raise exception 'bill_not_editable'; end if;
  delete from public.purchase_bill_lines where bill_id=p_bill_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    v_location:=null;
    select * into v_product from public.products where id=(x->>'product_id')::uuid and organization_id=p_organization_id and status='active';
    if not found then raise exception 'invalid_inventory_product'; end if;
    if v_product.kind='product' and v_product.track_inventory then
      if v_branch is null then raise exception 'inventory_branch_required'; end if;
      v_location:=nullif(x->>'inventory_location_id','')::uuid;
      if v_location is null then select id into v_location from public.inventory_locations where organization_id=p_organization_id and branch_id=v_branch and is_default and status='active'; end if;
      if v_location is null or not exists(select 1 from public.inventory_locations where id=v_location and organization_id=p_organization_id and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
    end if;
    select * into v_uom from public.resolve_product_uom(p_organization_id,v_product.id,nullif(x->>'transaction_unit_id','')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric);
    insert into public.purchase_bill_lines(bill_id,organization_id,description,quantity,unit_price,discount,tax_rate_id,expense_account_id,product_id,inventory_location_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_price)
    values(p_bill_id,p_organization_id,trim(x->>'description'),v_uom.normalized_quantity,v_uom.primary_rate,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'expense_account_id')::uuid,v_product.id,v_location,(x->>'quantity')::numeric,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,(x->>'unit_price')::numeric);
  end loop;
end $$;

create or replace function public.post_stock_operation_uom(
  p_operation_id uuid,p_organization_id uuid,p_branch_id uuid,p_operation_type public.stock_operation_type,p_transaction_date date,
  p_product_id uuid,p_source_location_id uuid,p_destination_location_id uuid,p_transaction_quantity numeric,p_transaction_unit_id uuid,
  p_transaction_unit_cost numeric default null,p_reference text default null,p_reason text default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uom record; v_result jsonb; v_primary_cost numeric;
begin
  if not public.is_active_org_member(p_organization_id) then raise exception 'not_authorized'; end if;
  select * into v_uom from public.resolve_product_uom(p_organization_id,p_product_id,p_transaction_unit_id,p_transaction_quantity,coalesce(p_transaction_unit_cost,0));
  v_primary_cost:=case when p_transaction_unit_cost is null then null else v_uom.primary_rate end;
  v_result:=public.post_stock_operation(p_operation_id,p_organization_id,p_branch_id,p_operation_type,p_transaction_date,p_product_id,p_source_location_id,p_destination_location_id,v_uom.normalized_quantity,v_primary_cost,p_reference,p_reason,p_notes);
  insert into public.stock_operation_uom_details(operation_id,organization_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_cost)
  values(p_operation_id,p_organization_id,p_transaction_quantity,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,p_transaction_unit_cost)
  on conflict(operation_id) do nothing;
  return v_result||jsonb_build_object('transaction_quantity',p_transaction_quantity,'transaction_unit_code',v_uom.unit_code,'normalized_quantity',v_uom.normalized_quantity);
end $$;

-- Product unit integrity extends the existing organization checks.
create or replace function public.inventory_master_integrity() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if tg_table_name='products' then
    if new.unit_id is not null and not exists(select 1 from public.inventory_units where id=new.unit_id and organization_id=new.organization_id) then raise exception 'Unit must belong to the product organization'; end if;
    if new.secondary_unit_id is not null and not exists(select 1 from public.inventory_units where id=new.secondary_unit_id and organization_id=new.organization_id) then raise exception 'Secondary unit must belong to the product organization'; end if;
    if new.unit_id is not null and (tg_op='INSERT' or new.unit_id is distinct from old.unit_id) and not exists(select 1 from public.inventory_units where id=new.unit_id and organization_id=new.organization_id and status='active') then raise exception 'Primary unit must be active'; end if;
    if new.secondary_unit_id is not null and (tg_op='INSERT' or new.secondary_unit_id is distinct from old.secondary_unit_id) and not exists(select 1 from public.inventory_units where id=new.secondary_unit_id and organization_id=new.organization_id and status='active') then raise exception 'Secondary unit must be active'; end if;
    if new.tax_rate_id is not null and not exists(select 1 from public.tax_rates where id=new.tax_rate_id and organization_id=new.organization_id) then raise exception 'Tax rate must belong to the product organization'; end if;
  elsif tg_table_name='inventory_locations' then
    if not exists(select 1 from public.branches where id=new.branch_id and organization_id=new.organization_id) then raise exception 'Branch must belong to the location organization'; end if;
  end if;
  return new;
end $$;

revoke all on function public.ensure_default_inventory_units(uuid),public.save_inventory_unit(uuid,uuid,text,text,public.entity_status),public.resolve_product_uom(uuid,uuid,uuid,numeric,numeric),public.post_stock_operation_uom(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,uuid,numeric,text,text,text) from public,anon;
revoke all on function public.resolve_product_uom(uuid,uuid,uuid,numeric,numeric) from authenticated;
grant execute on function public.ensure_default_inventory_units(uuid),public.save_inventory_unit(uuid,uuid,text,text,public.entity_status),public.post_stock_operation_uom(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,uuid,numeric,text,text,text) to authenticated;

create or replace function public.save_operational_document(
 p_org uuid,p_kind text,p_id uuid,p_customer uuid,p_branch uuid,p_date date,p_expiry date,p_reference text,p_notes text,p_lines jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); x jsonb; v_number text; v_uom record;
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
     select * into v_uom from public.resolve_product_uom(p_org,(x->>'product_id')::uuid,nullif(x->>'transaction_unit_id','')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric);
     insert into public.sales_quotation_lines(quotation_id,organization_id,product_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_price)
     values(v_id,p_org,(x->>'product_id')::uuid,trim(x->>'description'),v_uom.normalized_quantity,v_uom.primary_rate,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'revenue_account_id')::uuid,(x->>'quantity')::numeric,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,(x->>'unit_price')::numeric);
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
     select * into v_uom from public.resolve_product_uom(p_org,(x->>'product_id')::uuid,nullif(x->>'transaction_unit_id','')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric);
     insert into public.delivery_note_lines(delivery_note_id,organization_id,product_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,transaction_quantity,transaction_unit_id,transaction_unit_code,transaction_unit_name,conversion_factor,transaction_unit_price)
     values(v_id,p_org,(x->>'product_id')::uuid,trim(x->>'description'),v_uom.normalized_quantity,v_uom.primary_rate,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'revenue_account_id')::uuid,(x->>'quantity')::numeric,v_uom.unit_id,v_uom.unit_code,v_uom.unit_name,v_uom.factor,(x->>'unit_price')::numeric);
   end loop;
 end if;
 perform public.accounting_audit(p_org,p_kind||'.saved',p_kind,v_id,jsonb_build_object('non_posting',true)); return v_id;
end $$;

-- These internal functions are callable only through the already-authorized
-- draft/document RPCs.
revoke all on function public.replace_sales_invoice_lines(uuid,uuid,jsonb),public.replace_purchase_bill_lines(uuid,uuid,jsonb),public.save_operational_document(uuid,text,uuid,uuid,uuid,date,date,text,text,jsonb) from public,anon;
grant execute on function public.save_operational_document(uuid,text,uuid,uuid,uuid,date,date,text,text,jsonb) to authenticated;
