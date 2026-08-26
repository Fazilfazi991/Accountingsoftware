create type public.product_kind as enum ('product','service');
create type public.inventory_movement_type as enum ('opening','adjustment_in','adjustment_out','transfer_in','transfer_out','purchase','purchase_return','sale','sales_return');
create type public.stock_operation_type as enum ('opening','adjustment_in','adjustment_out','transfer');

create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code = upper(code) and length(trim(code)) between 1 and 16),
  name text not null check (length(trim(name)) > 0),
  status public.entity_status not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.product_kind not null,
  name text not null check (length(trim(name)) > 0),
  sku text,
  category text,
  unit_id uuid references public.inventory_units(id),
  sales_price numeric(20,4) not null default 0 check (sales_price >= 0),
  purchase_price numeric(20,4) not null default 0 check (purchase_price >= 0),
  track_inventory boolean not null default false,
  reorder_level numeric(20,4) not null default 0 check (reorder_level >= 0),
  tax_rate_id uuid references public.tax_rates(id),
  status public.entity_status not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'product' or track_inventory = false),
  check (track_inventory = false or unit_id is not null)
);
create unique index products_org_sku_unique on public.products(organization_id, lower(sku)) where sku is not null and length(trim(sku)) > 0;
create index products_org_status_name_idx on public.products(organization_id, status, name);

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  name text not null check (length(trim(name)) > 0),
  code text not null check (length(trim(code)) > 0),
  is_default boolean not null default false,
  status public.entity_status not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, branch_id, code)
);
create unique index inventory_locations_one_default on public.inventory_locations(branch_id) where is_default and status = 'active';
create index inventory_locations_org_branch_idx on public.inventory_locations(organization_id, branch_id, status);

create table public.stock_operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  operation_type public.stock_operation_type not null,
  transaction_date date not null,
  product_id uuid not null references public.products(id),
  source_location_id uuid references public.inventory_locations(id),
  destination_location_id uuid references public.inventory_locations(id),
  quantity numeric(20,4) not null check (quantity > 0),
  reference text,
  reason text,
  notes text,
  status text not null default 'posted' check (status = 'posted'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz not null default now()
);
create index stock_operations_org_date_idx on public.stock_operations(organization_id, transaction_date desc, created_at desc);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  location_id uuid not null references public.inventory_locations(id),
  product_id uuid not null references public.products(id),
  transaction_date date not null,
  movement_type public.inventory_movement_type not null,
  signed_quantity numeric(20,4) not null check (signed_quantity <> 0),
  source_document_type text not null,
  source_document_id uuid not null,
  reference text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (source_document_type, source_document_id, movement_type, location_id, product_id)
);
create index stock_movements_org_product_location_idx on public.stock_movements(organization_id, product_id, location_id, transaction_date, created_at);
create index stock_movements_org_branch_date_idx on public.stock_movements(organization_id, branch_id, transaction_date desc, created_at desc);

alter table public.inventory_units enable row level security;
alter table public.products enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.stock_operations enable row level security;
alter table public.stock_movements enable row level security;

create policy inventory_units_select on public.inventory_units for select to authenticated using (public.is_active_org_member(organization_id));
create policy inventory_units_insert on public.inventory_units for insert to authenticated with check (auth.uid() is not null and created_by = auth.uid() and public.is_active_org_member(organization_id));
create policy inventory_units_update on public.inventory_units for update to authenticated using (public.is_active_org_member(organization_id)) with check (public.is_active_org_member(organization_id));
create policy products_select on public.products for select to authenticated using (public.is_active_org_member(organization_id));
create policy products_insert on public.products for insert to authenticated with check (auth.uid() is not null and created_by = auth.uid() and public.is_active_org_member(organization_id));
create policy products_update on public.products for update to authenticated using (public.is_active_org_member(organization_id)) with check (public.is_active_org_member(organization_id));
create policy inventory_locations_select on public.inventory_locations for select to authenticated using (public.is_active_org_member(organization_id));
create policy inventory_locations_insert on public.inventory_locations for insert to authenticated with check (auth.uid() is not null and created_by = auth.uid() and public.is_active_org_member(organization_id));
create policy inventory_locations_update on public.inventory_locations for update to authenticated using (public.is_active_org_member(organization_id)) with check (public.is_active_org_member(organization_id));
create policy stock_operations_select on public.stock_operations for select to authenticated using (public.is_active_org_member(organization_id));
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.is_active_org_member(organization_id));

create or replace function public.inventory_master_integrity() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and (new.organization_id<>old.organization_id or new.created_by<>old.created_by) then raise exception 'Organization and creator are immutable'; end if;
  if tg_table_name='products' then
    if new.unit_id is not null and not exists(select 1 from public.inventory_units where id=new.unit_id and organization_id=new.organization_id) then raise exception 'Unit must belong to the product organization'; end if;
    if new.tax_rate_id is not null and not exists(select 1 from public.tax_rates where id=new.tax_rate_id and organization_id=new.organization_id) then raise exception 'Tax rate must belong to the product organization'; end if;
  elsif tg_table_name='inventory_locations' then
    if not exists(select 1 from public.branches where id=new.branch_id and organization_id=new.organization_id) then raise exception 'Branch must belong to the location organization'; end if;
  end if;
  return new;
end $$;
create trigger inventory_units_integrity before insert or update on public.inventory_units for each row execute function public.inventory_master_integrity();
create trigger products_integrity before insert or update on public.products for each row execute function public.inventory_master_integrity();
create trigger inventory_locations_integrity before insert or update on public.inventory_locations for each row execute function public.inventory_master_integrity();

create or replace function public.deny_inventory_ledger_mutation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$ begin raise exception 'Posted inventory ledger records are immutable'; end $$;
create trigger stock_operations_immutable before update or delete on public.stock_operations for each row execute function public.deny_inventory_ledger_mutation();
create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function public.deny_inventory_ledger_mutation();

create trigger inventory_units_updated_at before update on public.inventory_units for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger inventory_locations_updated_at before update on public.inventory_locations for each row execute function public.set_updated_at();

create or replace function public.initialize_inventory_foundation(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid := auth.uid(); v_branch record;
begin
  if v_user is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  insert into public.inventory_units(organization_id,code,name,created_by) values
    (p_organization_id,'NOS','Numbers',v_user),(p_organization_id,'PCS','Pieces',v_user),(p_organization_id,'KG','Kilograms',v_user),(p_organization_id,'G','Grams',v_user),
    (p_organization_id,'L','Litres',v_user),(p_organization_id,'ML','Millilitres',v_user),(p_organization_id,'BOX','Boxes',v_user),(p_organization_id,'PACK','Packs',v_user)
  on conflict (organization_id,code) do nothing;
  for v_branch in select id, name from public.branches where organization_id=p_organization_id and status='active' loop
    if not exists(select 1 from public.inventory_locations where branch_id=v_branch.id and is_default and status='active') then
      insert into public.inventory_locations(organization_id,branch_id,name,code,is_default,created_by)
      values(p_organization_id,v_branch.id,v_branch.name || ' Main Stock','MAIN',true,v_user)
      on conflict (organization_id,branch_id,code) do update set is_default=true,status='active';
    end if;
  end loop;
  return jsonb_build_object('initialized',true);
end $$;

create or replace function public.post_stock_operation(
  p_operation_id uuid, p_organization_id uuid, p_branch_id uuid, p_operation_type public.stock_operation_type,
  p_transaction_date date, p_product_id uuid, p_source_location_id uuid, p_destination_location_id uuid,
  p_quantity numeric, p_reference text default null, p_reason text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid := auth.uid(); v_existing public.stock_operations%rowtype; v_product public.products%rowtype;
  v_source public.inventory_locations%rowtype; v_destination public.inventory_locations%rowtype; v_available numeric(20,4); v_key1 bigint; v_key2 bigint;
begin
  if v_user is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  if p_operation_id is null or p_quantity is null or p_quantity <= 0 or p_transaction_date is null then raise exception 'A positive quantity and transaction date are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-operation:' || p_operation_id::text,0));
  select * into v_existing from public.stock_operations where id=p_operation_id;
  if found then
    if v_existing.organization_id<>p_organization_id or v_existing.created_by<>v_user then raise exception 'Operation id is already in use'; end if;
    return jsonb_build_object('operation_id',v_existing.id,'idempotent',true,'quantity',v_existing.quantity);
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception 'Active branch not found'; end if;
  select * into v_product from public.products where id=p_product_id and organization_id=p_organization_id and status='active';
  if not found or v_product.kind<>'product' or not v_product.track_inventory then raise exception 'Active inventory-tracked product required'; end if;
  if p_operation_type in ('opening','adjustment_in','adjustment_out') then
    if p_source_location_id is null or p_destination_location_id is not null then raise exception 'One stock location is required'; end if;
    select * into v_source from public.inventory_locations where id=p_source_location_id and organization_id=p_organization_id and branch_id=p_branch_id and status='active';
    if not found then raise exception 'Active stock location not found'; end if;
  else
    if p_source_location_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id then raise exception 'Different source and destination locations are required'; end if;
    select * into v_source from public.inventory_locations where id=p_source_location_id and organization_id=p_organization_id and status='active';
    if not found then raise exception 'Active source location not found'; end if;
    select * into v_destination from public.inventory_locations where id=p_destination_location_id and organization_id=p_organization_id and status='active';
    if not found then raise exception 'Active destination location not found'; end if;
    if v_source.branch_id<>p_branch_id then raise exception 'Source location must belong to selected branch'; end if;
  end if;
  v_key1:=hashtextextended(p_organization_id::text||':'||p_product_id::text||':'||p_source_location_id::text,0);
  if p_operation_type='transfer' then
    v_key2:=hashtextextended(p_organization_id::text||':'||p_product_id::text||':'||p_destination_location_id::text,0);
    if v_key1<v_key2 then perform pg_advisory_xact_lock(v_key1); perform pg_advisory_xact_lock(v_key2); else perform pg_advisory_xact_lock(v_key2); perform pg_advisory_xact_lock(v_key1); end if;
  else perform pg_advisory_xact_lock(v_key1); end if;
  if p_operation_type in ('adjustment_out','transfer') then
    select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=p_organization_id and product_id=p_product_id and location_id=p_source_location_id;
    if v_available < p_quantity then raise exception 'Insufficient stock: available %, requested %',v_available,p_quantity; end if;
  end if;
  insert into public.stock_operations(id,organization_id,branch_id,operation_type,transaction_date,product_id,source_location_id,destination_location_id,quantity,reference,reason,notes,created_by)
  values(p_operation_id,p_organization_id,p_branch_id,p_operation_type,p_transaction_date,p_product_id,p_source_location_id,p_destination_location_id,p_quantity,nullif(trim(p_reference),''),nullif(trim(p_reason),''),nullif(trim(p_notes),''),v_user);
  if p_operation_type='opening' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by)
    values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'opening',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user);
  elsif p_operation_type='adjustment_in' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by)
    values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'adjustment_in',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user);
  elsif p_operation_type='adjustment_out' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by)
    values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'adjustment_out',-p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user);
  else
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values
      (p_organization_id,v_source.branch_id,p_source_location_id,p_product_id,p_transaction_date,'transfer_out',-p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user),
      (p_organization_id,v_destination.branch_id,p_destination_location_id,p_product_id,p_transaction_date,'transfer_in',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user);
  end if;
  perform public.accounting_audit(p_organization_id,'inventory.stock_operation.posted','stock_operation',p_operation_id,jsonb_build_object('type',p_operation_type,'product_id',p_product_id,'quantity',p_quantity,'branch_id',p_branch_id));
  return jsonb_build_object('operation_id',p_operation_id,'idempotent',false,'quantity',p_quantity);
end $$;

create or replace function public.get_stock_summary(p_organization_id uuid, p_branch_id uuid default null, p_product_id uuid default null, p_location_id uuid default null)
returns table(product_id uuid, product_name text, sku text, unit_code text, location_id uuid, location_name text, branch_id uuid, quantity_on_hand numeric, reorder_level numeric, low_stock boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query select p.id,p.name,p.sku,u.code,l.id,l.name,l.branch_id,coalesce(sum(m.signed_quantity),0)::numeric,p.reorder_level,(coalesce(sum(m.signed_quantity),0)<=p.reorder_level)
  from public.products p join public.inventory_units u on u.id=p.unit_id
  cross join public.inventory_locations l left join public.stock_movements m on m.product_id=p.id and m.location_id=l.id
  where p.organization_id=p_organization_id and p.kind='product' and p.track_inventory and l.organization_id=p_organization_id
    and (p_branch_id is null or l.branch_id=p_branch_id) and (p_product_id is null or p.id=p_product_id) and (p_location_id is null or l.id=p_location_id)
  group by p.id,p.name,p.sku,u.code,l.id,l.name,l.branch_id,p.reorder_level order by p.name,l.name;
end $$;

create or replace function public.get_stock_movement_report(p_organization_id uuid, p_branch_id uuid default null, p_product_id uuid default null, p_location_id uuid default null, p_from date default null, p_to date default null, p_movement_type public.inventory_movement_type default null)
returns table(id uuid, transaction_date date, movement_type public.inventory_movement_type, signed_quantity numeric, running_quantity numeric, reference text, notes text, created_at timestamptz, product_id uuid, product_name text, sku text, location_id uuid, location_name text, branch_id uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query with ordered as (
    select m.id,m.transaction_date,m.movement_type,m.signed_quantity,
      sum(m.signed_quantity) over(partition by m.product_id,m.location_id order by m.transaction_date,m.created_at,m.id rows unbounded preceding)::numeric as running_quantity,
      m.reference,m.notes,m.created_at,m.product_id,p.name as product_name,p.sku,m.location_id,l.name as location_name,m.branch_id
    from public.stock_movements m join public.products p on p.id=m.product_id join public.inventory_locations l on l.id=m.location_id
    where m.organization_id=p_organization_id and (p_branch_id is null or m.branch_id=p_branch_id) and (p_product_id is null or m.product_id=p_product_id) and (p_location_id is null or m.location_id=p_location_id)
  ) select o.* from ordered o where (p_from is null or o.transaction_date>=p_from) and (p_to is null or o.transaction_date<=p_to) and (p_movement_type is null or o.movement_type=p_movement_type)
    order by o.transaction_date desc,o.created_at desc,o.id desc limit 1000;
end $$;

revoke all on public.inventory_units,public.products,public.inventory_locations,public.stock_operations,public.stock_movements from anon,public;
grant select,insert,update on public.inventory_units,public.products,public.inventory_locations to authenticated;
grant select on public.stock_operations,public.stock_movements to authenticated;
revoke all on function public.initialize_inventory_foundation(uuid), public.post_stock_operation(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,text,text,text), public.get_stock_summary(uuid,uuid,uuid,uuid), public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) from public,anon;
grant execute on function public.initialize_inventory_foundation(uuid), public.post_stock_operation(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,text,text,text), public.get_stock_summary(uuid,uuid,uuid,uuid), public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) to authenticated;
