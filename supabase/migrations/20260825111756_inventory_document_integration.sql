alter table public.sales_invoice_lines add column product_id uuid references public.products(id), add column inventory_location_id uuid references public.inventory_locations(id);
alter table public.purchase_bill_lines add column product_id uuid references public.products(id), add column inventory_location_id uuid references public.inventory_locations(id);
alter table public.sales_credit_note_lines add column product_id uuid references public.products(id), add column inventory_location_id uuid references public.inventory_locations(id), add column return_to_stock boolean not null default false;
alter table public.purchase_debit_note_lines add column product_id uuid references public.products(id), add column inventory_location_id uuid references public.inventory_locations(id), add column return_from_stock boolean not null default false;
alter table public.stock_movements add column source_document_line_id uuid, add column source_origin_line_id uuid;

do $$ declare v_name text; begin
  select c.conname into v_name from pg_constraint c where c.conrelid='public.stock_movements'::regclass and c.contype='u' and pg_get_constraintdef(c.oid) like 'UNIQUE (source_document_type, source_document_id, movement_type, location_id, product_id)%';
  if v_name is not null then execute format('alter table public.stock_movements drop constraint %I',v_name); end if;
end $$;
create unique index stock_movements_document_line_effect_unique on public.stock_movements(source_document_type,source_document_id,source_document_line_id,movement_type,location_id,product_id) where source_document_line_id is not null;
create index stock_movements_source_document_idx on public.stock_movements(organization_id,source_document_type,source_document_id);
create index sales_invoice_lines_inventory_idx on public.sales_invoice_lines(organization_id,product_id,inventory_location_id) where product_id is not null;
create index purchase_bill_lines_inventory_idx on public.purchase_bill_lines(organization_id,product_id,inventory_location_id) where product_id is not null;

create or replace function public.replace_sales_invoice_lines(p_organization_id uuid,p_invoice_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_branch uuid; v_product public.products%rowtype; v_location uuid;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'invoice_lines_required'; end if;
  select branch_id into v_branch from public.sales_invoices where id=p_invoice_id and organization_id=p_organization_id and status='draft' for update;
  if not found then raise exception 'invoice_not_editable'; end if;
  delete from public.sales_invoice_lines where invoice_id=p_invoice_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    v_location:=null;
    if nullif(x->>'product_id','') is not null then
      select * into v_product from public.products where id=(x->>'product_id')::uuid and organization_id=p_organization_id and status='active';
      if not found then raise exception 'invalid_inventory_product'; end if;
      if v_product.kind='product' and v_product.track_inventory then
        if v_branch is null then raise exception 'inventory_branch_required'; end if;
        v_location:=nullif(x->>'inventory_location_id','')::uuid;
        if v_location is null then select id into v_location from public.inventory_locations where organization_id=p_organization_id and branch_id=v_branch and is_default and status='active'; end if;
        if v_location is null or not exists(select 1 from public.inventory_locations where id=v_location and organization_id=p_organization_id and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      end if;
    end if;
    insert into public.sales_invoice_lines(invoice_id,organization_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,product_id,inventory_location_id)
    values(p_invoice_id,p_organization_id,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,nullif(x->>'revenue_account_id','')::uuid,nullif(x->>'product_id','')::uuid,v_location);
  end loop;
end $$;

create or replace function public.replace_purchase_bill_lines(p_organization_id uuid,p_bill_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; v_branch uuid; v_product public.products%rowtype; v_location uuid;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'bill_lines_required'; end if;
  select branch_id into v_branch from public.purchase_bills where id=p_bill_id and organization_id=p_organization_id and status='draft' for update;
  if not found then raise exception 'bill_not_editable'; end if;
  delete from public.purchase_bill_lines where bill_id=p_bill_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    v_location:=null;
    if nullif(x->>'product_id','') is not null then
      select * into v_product from public.products where id=(x->>'product_id')::uuid and organization_id=p_organization_id and status='active';
      if not found then raise exception 'invalid_inventory_product'; end if;
      if v_product.kind='product' and v_product.track_inventory then
        if v_branch is null then raise exception 'inventory_branch_required'; end if;
        v_location:=nullif(x->>'inventory_location_id','')::uuid;
        if v_location is null then select id into v_location from public.inventory_locations where organization_id=p_organization_id and branch_id=v_branch and is_default and status='active'; end if;
        if v_location is null or not exists(select 1 from public.inventory_locations where id=v_location and organization_id=p_organization_id and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      end if;
    end if;
    insert into public.purchase_bill_lines(bill_id,organization_id,description,quantity,unit_price,discount,tax_rate_id,expense_account_id,product_id,inventory_location_id)
    values(p_bill_id,p_organization_id,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'discount')::numeric,0),nullif(x->>'tax_rate_id','')::uuid,(x->>'expense_account_id')::uuid,nullif(x->>'product_id','')::uuid,v_location);
  end loop;
end $$;

create or replace function public.replace_sales_credit_note_lines(p_organization_id uuid,p_credit_note_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; s public.sales_invoice_lines%rowtype; v_invoice uuid; v_return boolean;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'credit_note_lines_required'; end if;
  select invoice_id into v_invoice from public.sales_credit_notes where id=p_credit_note_id and organization_id=p_organization_id and status='draft' for update;
  if v_invoice is null then raise exception 'credit_note_not_editable'; end if;
  delete from public.sales_credit_note_lines where credit_note_id=p_credit_note_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    select * into s from public.sales_invoice_lines where id=(x->>'source_invoice_line_id')::uuid and invoice_id=v_invoice and organization_id=p_organization_id;
    v_return:=coalesce((x->>'return_to_stock')::boolean,false);
    if not found or coalesce((x->>'quantity')::numeric,0)<=0 or (x->>'quantity')::numeric>s.quantity then raise exception 'invalid_credit_note_line'; end if;
    if v_return and (s.product_id is null or s.inventory_location_id is null or not exists(select 1 from public.products p where p.id=s.product_id and p.organization_id=p_organization_id and p.status='active' and p.kind='product' and p.track_inventory) or not exists(select 1 from public.inventory_locations l where l.id=s.inventory_location_id and l.organization_id=p_organization_id and l.status='active')) then raise exception 'invalid_sales_stock_return'; end if;
    insert into public.sales_credit_note_lines(credit_note_id,organization_id,source_invoice_line_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,product_id,inventory_location_id,return_to_stock)
    values(p_credit_note_id,p_organization_id,s.id,s.description,(x->>'quantity')::numeric,s.unit_price,round(s.discount*(x->>'quantity')::numeric/s.quantity,6),s.tax_rate_id,s.revenue_account_id,s.product_id,s.inventory_location_id,v_return);
  end loop;
end $$;

create or replace function public.replace_purchase_debit_note_lines(p_organization_id uuid,p_debit_note_id uuid,p_lines jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; s public.purchase_bill_lines%rowtype; v_bill uuid; v_return boolean;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'debit_note_lines_required'; end if;
  select bill_id into v_bill from public.purchase_debit_notes where id=p_debit_note_id and organization_id=p_organization_id and status='draft' for update;
  if v_bill is null then raise exception 'debit_note_not_editable'; end if;
  delete from public.purchase_debit_note_lines where debit_note_id=p_debit_note_id;
  for x in select value from jsonb_array_elements(p_lines) loop
    select * into s from public.purchase_bill_lines where id=(x->>'source_bill_line_id')::uuid and bill_id=v_bill and organization_id=p_organization_id;
    v_return:=coalesce((x->>'return_from_stock')::boolean,false);
    if not found or coalesce((x->>'quantity')::numeric,0)<=0 or (x->>'quantity')::numeric>s.quantity then raise exception 'invalid_debit_note_line'; end if;
    if v_return and (s.product_id is null or s.inventory_location_id is null or not exists(select 1 from public.products p where p.id=s.product_id and p.organization_id=p_organization_id and p.status='active' and p.kind='product' and p.track_inventory) or not exists(select 1 from public.inventory_locations l where l.id=s.inventory_location_id and l.organization_id=p_organization_id and l.status='active')) then raise exception 'invalid_purchase_stock_return'; end if;
    insert into public.purchase_debit_note_lines(debit_note_id,organization_id,source_bill_line_id,description,quantity,unit_price,discount,tax_rate_id,expense_account_id,product_id,inventory_location_id,return_from_stock)
    values(p_debit_note_id,p_organization_id,s.id,s.description,(x->>'quantity')::numeric,s.unit_price,round(s.discount*(x->>'quantity')::numeric/s.quantity,6),s.tax_rate_id,s.expense_account_id,s.product_id,s.inventory_location_id,v_return);
  end loop;
end $$;

create or replace function public.apply_document_stock_effect() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_scope record; v_line record; v_available numeric(20,4); v_org uuid; v_branch uuid; v_date date; v_doc_type text; v_number text; v_event text;
begin
  if old.status::text='posted' or new.status::text<>'posted' then return new; end if;
  v_org:=new.organization_id; v_branch:=new.branch_id;
  if auth.uid() is null or not public.is_active_org_member(v_org) then raise exception 'Active organization membership required'; end if;
  if tg_table_name='sales_invoices' then
    v_date:=new.invoice_date; v_doc_type:='sales_invoice'; v_number:=new.invoice_number; v_event:='inventory.sale.posted';
    if exists(select 1 from public.sales_invoice_lines l left join public.products p on p.id=l.product_id and p.organization_id=v_org where l.invoice_id=new.id and l.product_id is not null and (p.id is null or p.status<>'active')) then raise exception 'invalid_inventory_product'; end if;
    for v_scope in select l.product_id,l.inventory_location_id,sum(l.quantity) quantity from public.sales_invoice_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.invoice_id=new.id group by l.product_id,l.inventory_location_id order by hashtextextended(v_org::text||':'||l.product_id::text||':'||l.inventory_location_id::text,0) loop
      if v_scope.inventory_location_id is null or not exists(select 1 from public.inventory_locations where id=v_scope.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v_scope.product_id::text||':'||v_scope.inventory_location_id::text,0));
      select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=v_org and product_id=v_scope.product_id and location_id=v_scope.inventory_location_id;
      if v_available<v_scope.quantity then raise exception 'insufficient_stock: available %, requested %',v_available,v_scope.quantity; end if;
    end loop;
    for v_line in select l.* from public.sales_invoice_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.invoice_id=new.id order by l.id loop
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'sale',-v_line.quantity,v_doc_type,new.id,v_line.id,v_number,new.notes,auth.uid());
    end loop;
  elsif tg_table_name='purchase_bills' then
    v_date:=new.bill_date; v_doc_type:='purchase_bill'; v_number:=new.bill_number; v_event:='inventory.purchase.posted';
    if exists(select 1 from public.purchase_bill_lines l left join public.products p on p.id=l.product_id and p.organization_id=v_org where l.bill_id=new.id and l.product_id is not null and (p.id is null or p.status<>'active')) then raise exception 'invalid_inventory_product'; end if;
    for v_line in select l.* from public.purchase_bill_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.bill_id=new.id order by l.id loop
      if v_line.inventory_location_id is null or not exists(select 1 from public.inventory_locations where id=v_line.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'purchase',v_line.quantity,v_doc_type,new.id,v_line.id,v_number,new.notes,auth.uid());
    end loop;
  elsif tg_table_name='sales_credit_notes' then
    v_date:=new.credit_note_date; v_doc_type:='sales_credit_note'; v_number:=new.credit_note_number; v_event:='inventory.sales_return.posted';
    for v_line in select * from public.sales_credit_note_lines where credit_note_id=new.id and return_to_stock order by id loop
      if v_line.product_id is null or v_line.inventory_location_id is null or not exists(select 1 from public.products where id=v_line.product_id and organization_id=v_org and status='active' and kind='product' and track_inventory) or not exists(select 1 from public.inventory_locations where id=v_line.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_sales_stock_return'; end if;
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,source_origin_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'sales_return',v_line.quantity,v_doc_type,new.id,v_line.id,v_line.source_invoice_line_id,v_number,new.notes,auth.uid());
    end loop;
  elsif tg_table_name='purchase_debit_notes' then
    v_date:=new.debit_note_date; v_doc_type:='purchase_debit_note'; v_number:=new.debit_note_number; v_event:='inventory.purchase_return.posted';
    for v_scope in select product_id,inventory_location_id,sum(quantity) quantity from public.purchase_debit_note_lines where debit_note_id=new.id and return_from_stock group by product_id,inventory_location_id order by hashtextextended(v_org::text||':'||product_id::text||':'||inventory_location_id::text,0) loop
      if v_scope.product_id is null or v_scope.inventory_location_id is null or not exists(select 1 from public.products where id=v_scope.product_id and organization_id=v_org and status='active' and kind='product' and track_inventory) or not exists(select 1 from public.inventory_locations where id=v_scope.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_purchase_stock_return'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v_scope.product_id::text||':'||v_scope.inventory_location_id::text,0));
      select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=v_org and product_id=v_scope.product_id and location_id=v_scope.inventory_location_id;
      if v_available<v_scope.quantity then raise exception 'insufficient_stock_for_purchase_return: available %, requested %',v_available,v_scope.quantity; end if;
    end loop;
    for v_line in select * from public.purchase_debit_note_lines where debit_note_id=new.id and return_from_stock order by id loop
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,source_origin_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'purchase_return',-v_line.quantity,v_doc_type,new.id,v_line.id,v_line.source_bill_line_id,v_number,new.notes,auth.uid());
    end loop;
  end if;
  perform public.accounting_audit(v_org,v_event,v_doc_type,new.id,jsonb_build_object('branch_id',v_branch));
  return new;
end $$;

create trigger sales_invoice_stock_effect after update of status on public.sales_invoices for each row execute function public.apply_document_stock_effect();
create trigger purchase_bill_stock_effect after update of status on public.purchase_bills for each row execute function public.apply_document_stock_effect();
create trigger sales_credit_note_stock_effect after update of status on public.sales_credit_notes for each row execute function public.apply_document_stock_effect();
create trigger purchase_debit_note_stock_effect after update of status on public.purchase_debit_notes for each row execute function public.apply_document_stock_effect();

drop function public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type);
create function public.get_stock_movement_report(p_organization_id uuid, p_branch_id uuid default null, p_product_id uuid default null, p_location_id uuid default null, p_from date default null, p_to date default null, p_movement_type public.inventory_movement_type default null)
returns table(id uuid, transaction_date date, movement_type public.inventory_movement_type, signed_quantity numeric, running_quantity numeric, reference text, notes text, created_at timestamptz, product_id uuid, product_name text, sku text, location_id uuid, location_name text, branch_id uuid, source_document_type text, source_document_id uuid, source_document_line_id uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query with ordered as (
    select m.id,m.transaction_date,m.movement_type,m.signed_quantity,sum(m.signed_quantity) over(partition by m.product_id,m.location_id order by m.transaction_date,m.created_at,m.id rows unbounded preceding)::numeric as running_quantity,m.reference,m.notes,m.created_at,m.product_id,p.name product_name,p.sku,m.location_id,l.name location_name,m.branch_id,m.source_document_type,m.source_document_id,m.source_document_line_id
    from public.stock_movements m join public.products p on p.id=m.product_id join public.inventory_locations l on l.id=m.location_id
    where m.organization_id=p_organization_id and (p_branch_id is null or m.branch_id=p_branch_id) and (p_product_id is null or m.product_id=p_product_id) and (p_location_id is null or m.location_id=p_location_id)
  ) select o.* from ordered o where (p_from is null or o.transaction_date>=p_from) and (p_to is null or o.transaction_date<=p_to) and (p_movement_type is null or o.movement_type=p_movement_type) order by o.transaction_date desc,o.created_at desc,o.id desc limit 1000;
end $$;

revoke all on function public.apply_document_stock_effect() from public,anon,authenticated;
revoke all on function public.replace_sales_invoice_lines(uuid,uuid,jsonb),public.replace_purchase_bill_lines(uuid,uuid,jsonb),public.replace_sales_credit_note_lines(uuid,uuid,jsonb),public.replace_purchase_debit_note_lines(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) from public,anon;
grant execute on function public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) to authenticated;
