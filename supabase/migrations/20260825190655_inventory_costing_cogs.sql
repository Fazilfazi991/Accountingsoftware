-- Batch 9.3: forward-only inventory valuation and COGS ledger.
alter table public.journal_entries drop constraint journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check check(source_type in ('manual_journal','opening_balance','sales_invoice','sales_credit_note','purchase_bill','purchase_debit_note','customer_receipt','supplier_payment','expense','bank_transfer','cash_receipt','cash_payment','inventory_cost'));

insert into public.accounts(organization_id,account_group_id,code,name,account_type,system_key,is_system,allow_manual_posting)
select g.organization_id,g.id,c.code,'Inventory Adjustments','expense','inventory_adjustment',true,false
from public.account_groups g
cross join lateral(select to_char(n,'FM0000') code from generate_series(5001,5999) n where not exists(select 1 from public.accounts a where a.organization_id=g.organization_id and a.code=to_char(n,'FM0000')) order by n limit 1) c
where g.system_key='cost_of_sales'
on conflict (organization_id,system_key) do nothing;

create table public.inventory_cost_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity,
  organization_id uuid not null references public.organizations(id),
  product_id uuid not null references public.products(id),
  event_date date not null,
  event_type text not null check(event_type in ('opening','adjustment_in','adjustment_out','transfer_out','transfer_in','purchase','purchase_return','purchase_price_adjustment','sale','sales_return')),
  quantity_delta numeric(20,4) not null,
  unit_cost numeric(24,10) not null check(unit_cost>=0),
  value_delta numeric(24,6) not null,
  resulting_quantity numeric(20,4) not null check(resulting_quantity>=0),
  resulting_value numeric(24,6) not null check(resulting_value>=0),
  resulting_average_cost numeric(24,10) not null check(resulting_average_cost>=0),
  stock_movement_id uuid references public.stock_movements(id),
  source_document_type text not null,
  source_document_id uuid not null,
  source_document_line_id uuid,
  original_cost_event_id uuid references public.inventory_cost_events(id),
  journal_entry_id uuid references public.journal_entries(id),
  reference text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(stock_movement_id),
  unique(source_document_type,source_document_id,source_document_line_id,event_type)
);
create index inventory_cost_events_latest_idx on public.inventory_cost_events(organization_id,product_id,sequence desc);
create index inventory_cost_events_reporting_idx on public.inventory_cost_events(organization_id,event_date,event_type);
alter table public.inventory_cost_events enable row level security;
create policy inventory_cost_events_select on public.inventory_cost_events for select to authenticated using(public.is_active_org_member(organization_id));
grant select on public.inventory_cost_events to authenticated;

create trigger inventory_cost_events_immutable before update or delete on public.inventory_cost_events for each row execute function public.deny_inventory_ledger_mutation();

create or replace function public.record_inventory_cost_event(
  p_organization_id uuid,p_product_id uuid,p_event_date date,p_event_type text,p_quantity_delta numeric,
  p_value_amount numeric,p_stock_movement_id uuid,p_source_document_type text,p_source_document_id uuid,
  p_source_document_line_id uuid,p_original_cost_event_id uuid,p_journal_entry_id uuid,p_reference text)
returns public.inventory_cost_events language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_previous public.inventory_cost_events%rowtype; v_result public.inventory_cost_events%rowtype;
  v_quantity numeric(20,4); v_value numeric(24,6); v_amount numeric(24,6); v_unit numeric(24,10); v_actual numeric(20,4); v_has_previous boolean;
begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  if p_event_date is null or p_event_type not in ('opening','adjustment_in','adjustment_out','transfer_out','transfer_in','purchase','purchase_return','purchase_price_adjustment','sale','sales_return') then raise exception 'invalid_inventory_cost_event'; end if;
  if not exists(select 1 from public.products where id=p_product_id and organization_id=p_organization_id and kind='product' and track_inventory) then raise exception 'invalid_inventory_product'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-cost:'||p_organization_id::text||':'||p_product_id::text,0));
  select * into v_previous from public.inventory_cost_events where organization_id=p_organization_id and product_id=p_product_id order by sequence desc limit 1;
  v_has_previous:=found;
  select coalesce(sum(signed_quantity),0) into v_actual from public.stock_movements where organization_id=p_organization_id and product_id=p_product_id and (p_stock_movement_id is null or id<>p_stock_movement_id);
  if not v_has_previous then
    if v_actual<>0 and not (p_event_type='opening' and p_stock_movement_id is null and p_source_document_type='valuation_initialization' and p_quantity_delta=v_actual) then raise exception 'inventory_cost_initialization_required'; end if;
    v_previous.resulting_quantity:=0; v_previous.resulting_value:=0; v_previous.resulting_average_cost:=0;
  elsif v_actual<>v_previous.resulting_quantity then
    raise exception 'inventory_quantity_cost_ledger_mismatch';
  end if;
  if p_quantity_delta=0 then
    if p_event_type<>'purchase_price_adjustment' or p_value_amount is null or p_value_amount<=0 then raise exception 'invalid_zero_quantity_cost_event'; end if;
    v_amount:=round(p_value_amount,6); v_quantity:=v_previous.resulting_quantity; v_value:=v_previous.resulting_value-v_amount; v_unit:=v_previous.resulting_average_cost;
  elsif p_quantity_delta>0 then
    if p_value_amount is null or p_value_amount<=0 then raise exception 'positive_inventory_cost_required'; end if;
    v_amount:=round(p_value_amount,6); v_quantity:=v_previous.resulting_quantity+p_quantity_delta; v_value:=v_previous.resulting_value+v_amount; v_unit:=round(v_amount/p_quantity_delta,10);
  else
    if v_previous.resulting_quantity < abs(p_quantity_delta) then raise exception 'insufficient_costed_stock'; end if;
    if p_value_amount is null then
      v_amount:=case when v_previous.resulting_quantity=abs(p_quantity_delta) then v_previous.resulting_value else round(abs(p_quantity_delta)*v_previous.resulting_average_cost,6) end;
    else v_amount:=round(p_value_amount,6); end if;
    v_quantity:=v_previous.resulting_quantity+p_quantity_delta; v_value:=v_previous.resulting_value-v_amount; v_unit:=case when p_quantity_delta=0 then 0 else round(v_amount/abs(p_quantity_delta),10) end;
  end if;
  if v_quantity<0 or v_value<0 or (v_quantity>0 and v_value<=0) then raise exception 'inventory_cost_would_be_zero_or_negative'; end if;
  if v_quantity=0 then v_value:=0; end if;
  insert into public.inventory_cost_events(organization_id,product_id,event_date,event_type,quantity_delta,unit_cost,value_delta,resulting_quantity,resulting_value,resulting_average_cost,stock_movement_id,source_document_type,source_document_id,source_document_line_id,original_cost_event_id,journal_entry_id,reference,created_by)
  values(p_organization_id,p_product_id,p_event_date,p_event_type,p_quantity_delta,v_unit,case when p_quantity_delta>0 then v_amount else -v_amount end,v_quantity,v_value,case when v_quantity=0 then 0 else round(v_value/v_quantity,10) end,p_stock_movement_id,p_source_document_type,p_source_document_id,p_source_document_line_id,p_original_cost_event_id,p_journal_entry_id,p_reference,auth.uid()) returning * into v_result;
  return v_result;
end $$;
revoke all on function public.record_inventory_cost_event(uuid,uuid,date,text,numeric,numeric,uuid,text,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;

create or replace function public.create_inventory_cost_journal(p_organization_id uuid,p_source_id uuid,p_branch_id uuid,p_date date,p_reference text,p_description text,p_debit_account uuid,p_credit_account uuid,p_amount numeric)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=gen_random_uuid();
begin
  if p_amount<=0 then raise exception 'positive_inventory_journal_amount_required'; end if;
  insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by)
  values(v_id,p_organization_id,p_branch_id,p_date,'inventory_cost',p_source_id,p_reference,p_description,auth.uid());
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values
    (p_organization_id,v_id,1,p_debit_account,p_description,round(p_amount,6),0,p_branch_id),
    (p_organization_id,v_id,2,p_credit_account,p_description,0,round(p_amount,6),p_branch_id);
  perform public.post_journal_entry(p_organization_id,v_id);
  return v_id;
end $$;
revoke all on function public.create_inventory_cost_journal(uuid,uuid,uuid,date,text,text,uuid,uuid,numeric) from public,anon,authenticated;

drop trigger sales_invoice_stock_effect on public.sales_invoices;
drop trigger purchase_bill_stock_effect on public.purchase_bills;
drop trigger sales_credit_note_stock_effect on public.sales_credit_notes;
drop trigger purchase_debit_note_stock_effect on public.purchase_debit_notes;

create or replace function public.apply_document_stock_effect() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_scope record; v_line record; v_available numeric(20,4); v_org uuid; v_branch uuid; v_date date; v_doc_type text; v_number text; v_event text;
  v_inventory uuid; v_cogs uuid; v_journal uuid; v_sm uuid; v_cost public.inventory_cost_events%rowtype; v_origin public.inventory_cost_events%rowtype;
  v_total numeric(24,6):=0; v_amount numeric(24,6); v_line_no smallint:=0;
begin
  if old.status::text='posted' or new.status::text<>'posted' then return new; end if;
  v_org:=new.organization_id; v_branch:=new.branch_id;
  if auth.uid() is null or not public.is_active_org_member(v_org) then raise exception 'Active organization membership required'; end if;
  select id into v_inventory from public.accounts where organization_id=v_org and system_key='inventory' and is_active;
  select id into v_cogs from public.accounts where organization_id=v_org and system_key='cost_of_goods_sold' and is_active;
  if v_inventory is null or v_cogs is null then raise exception 'inventory_system_account_missing'; end if;

  if tg_table_name='sales_invoices' then
    v_date:=new.invoice_date; v_doc_type:='sales_invoice'; v_number:=new.invoice_number; v_event:='inventory.sale.costed';
    if exists(select 1 from public.sales_invoice_lines l left join public.products p on p.id=l.product_id and p.organization_id=v_org where l.invoice_id=new.id and l.product_id is not null and (p.id is null or p.status<>'active')) then raise exception 'invalid_inventory_product'; end if;
    if exists(select 1 from public.sales_invoice_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.invoice_id=new.id) then
      v_journal:=gen_random_uuid();
      insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by) values(v_journal,v_org,v_branch,v_date,'inventory_cost',new.id,v_number,'Cost of goods sold',auth.uid());
    end if;
    for v_scope in select l.product_id,l.inventory_location_id,sum(l.quantity) quantity from public.sales_invoice_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.invoice_id=new.id group by l.product_id,l.inventory_location_id order by hashtextextended(v_org::text||':'||l.product_id::text||':'||l.inventory_location_id::text,0) loop
      if v_scope.inventory_location_id is null or not exists(select 1 from public.inventory_locations where id=v_scope.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v_scope.product_id::text||':'||v_scope.inventory_location_id::text,0));
      select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=v_org and product_id=v_scope.product_id and location_id=v_scope.inventory_location_id;
      if v_available<v_scope.quantity then raise exception 'insufficient_stock: available %, requested %',v_available,v_scope.quantity; end if;
    end loop;
    for v_line in select l.* from public.sales_invoice_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.invoice_id=new.id order by l.id loop
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'sale',-v_line.quantity,v_doc_type,new.id,v_line.id,v_number,new.notes,auth.uid()) returning id into v_sm;
      v_cost:=public.record_inventory_cost_event(v_org,v_line.product_id,v_date,'sale',-v_line.quantity,null,v_sm,v_doc_type,new.id,v_line.id,null,v_journal,v_number);
      v_total:=v_total-v_cost.value_delta;
    end loop;
    if v_total>0 then
      insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,1,v_cogs,'Cost of goods sold',v_total,0,v_branch),(v_org,v_journal,2,v_inventory,'Inventory issued',0,v_total,v_branch);
      perform public.post_journal_entry(v_org,v_journal);
    end if;

  elsif tg_table_name='purchase_bills' then
    v_date:=new.bill_date; v_doc_type:='purchase_bill'; v_number:=new.bill_number; v_event:='inventory.purchase.costed';
    if exists(select 1 from public.purchase_bill_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.bill_id=new.id) then
      v_journal:=gen_random_uuid();
      insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by) values(v_journal,v_org,v_branch,v_date,'inventory_cost',new.id,v_number,'Capitalize purchased inventory',auth.uid());
    end if;
    for v_line in select l.* from public.purchase_bill_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.bill_id=new.id order by l.id loop
      if v_line.inventory_location_id is null or not exists(select 1 from public.inventory_locations where id=v_line.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_inventory_location'; end if;
      v_amount:=round(v_line.quantity*v_line.unit_price-v_line.discount,6); if v_amount<=0 then raise exception 'positive_inventory_cost_required'; end if;
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'purchase',v_line.quantity,v_doc_type,new.id,v_line.id,v_number,new.notes,auth.uid()) returning id into v_sm;
      v_cost:=public.record_inventory_cost_event(v_org,v_line.product_id,v_date,'purchase',v_line.quantity,v_amount,v_sm,v_doc_type,new.id,v_line.id,null,v_journal,v_number);
      v_total:=v_total+v_amount; v_line_no:=v_line_no+1;
      insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,v_line_no,v_line.expense_account_id,'Reclassify purchased inventory',0,v_amount,v_branch);
    end loop;
    if v_total>0 then
      v_line_no:=v_line_no+1; insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,v_line_no,v_inventory,'Purchased inventory',v_total,0,v_branch);
      perform public.post_journal_entry(v_org,v_journal);
    end if;

  elsif tg_table_name='sales_credit_notes' then
    v_date:=new.credit_note_date; v_doc_type:='sales_credit_note'; v_number:=new.credit_note_number; v_event:='inventory.sales_return.costed';
    if exists(select 1 from public.sales_credit_note_lines where credit_note_id=new.id and return_to_stock) then
      v_journal:=gen_random_uuid(); insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by) values(v_journal,v_org,v_branch,v_date,'inventory_cost',new.id,v_number,'Sales return at original cost',auth.uid());
    end if;
    for v_line in select * from public.sales_credit_note_lines where credit_note_id=new.id and return_to_stock order by id loop
      if v_line.product_id is null or v_line.inventory_location_id is null or not exists(select 1 from public.inventory_locations where id=v_line.inventory_location_id and organization_id=v_org and branch_id=v_branch and status='active') then raise exception 'invalid_sales_stock_return'; end if;
      select * into v_origin from public.inventory_cost_events where organization_id=v_org and source_document_type='sales_invoice' and source_document_line_id=v_line.source_invoice_line_id and event_type='sale';
      if not found then raise exception 'original_sales_cost_not_found'; end if;
      v_amount:=round(v_line.quantity*v_origin.unit_cost,6);
      insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,source_origin_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'sales_return',v_line.quantity,v_doc_type,new.id,v_line.id,v_line.source_invoice_line_id,v_number,new.notes,auth.uid()) returning id into v_sm;
      v_cost:=public.record_inventory_cost_event(v_org,v_line.product_id,v_date,'sales_return',v_line.quantity,v_amount,v_sm,v_doc_type,new.id,v_line.id,v_origin.id,v_journal,v_number); v_total:=v_total+v_amount;
    end loop;
    if v_total>0 then insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,1,v_inventory,'Inventory returned',v_total,0,v_branch),(v_org,v_journal,2,v_cogs,'Reverse cost of goods sold',0,v_total,v_branch); perform public.post_journal_entry(v_org,v_journal); end if;

  elsif tg_table_name='purchase_debit_notes' then
    v_date:=new.debit_note_date; v_doc_type:='purchase_debit_note'; v_number:=new.debit_note_number; v_event:='inventory.purchase_return.costed';
    if exists(select 1 from public.purchase_debit_note_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.debit_note_id=new.id) then
      v_journal:=gen_random_uuid(); insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by) values(v_journal,v_org,v_branch,v_date,'inventory_cost',new.id,v_number,'Reverse inventory purchase',auth.uid());
    end if;
    for v_line in select l.* from public.purchase_debit_note_lines l join public.products p on p.id=l.product_id and p.organization_id=v_org and p.kind='product' and p.track_inventory where l.debit_note_id=new.id order by l.id loop
      v_amount:=round(v_line.quantity*v_line.unit_price-v_line.discount,6); if v_amount<=0 then raise exception 'invalid_purchase_return_cost'; end if;
      if v_line.return_from_stock then
        perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v_line.product_id::text||':'||v_line.inventory_location_id::text,0));
        select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=v_org and product_id=v_line.product_id and location_id=v_line.inventory_location_id;
        if v_available<v_line.quantity then raise exception 'insufficient_stock_for_purchase_return: available %, requested %',v_available,v_line.quantity; end if;
        insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,source_document_line_id,source_origin_line_id,reference,notes,created_by) values(v_org,v_branch,v_line.inventory_location_id,v_line.product_id,v_date,'purchase_return',-v_line.quantity,v_doc_type,new.id,v_line.id,v_line.source_bill_line_id,v_number,new.notes,auth.uid()) returning id into v_sm;
        select * into v_origin from public.inventory_cost_events where organization_id=v_org and source_document_type='purchase_bill' and source_document_line_id=v_line.source_bill_line_id and event_type='purchase';
        if not found then raise exception 'original_purchase_cost_not_found'; end if;
        v_amount:=round(v_line.quantity*v_origin.unit_cost,6);
        v_cost:=public.record_inventory_cost_event(v_org,v_line.product_id,v_date,'purchase_return',-v_line.quantity,v_amount,v_sm,v_doc_type,new.id,v_line.id,v_origin.id,v_journal,v_number);
      else
        v_cost:=public.record_inventory_cost_event(v_org,v_line.product_id,v_date,'purchase_price_adjustment',0,v_amount,null,v_doc_type,new.id,v_line.id,null,v_journal,v_number);
      end if;
      v_total:=v_total+v_amount; v_line_no:=v_line_no+1;
      insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,v_line_no,v_line.expense_account_id,'Reclassify inventory debit note',v_amount,0,v_branch);
    end loop;
    if v_total>0 then v_line_no:=v_line_no+1; insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(v_org,v_journal,v_line_no,v_inventory,'Inventory purchase reversal',0,v_total,v_branch); perform public.post_journal_entry(v_org,v_journal); end if;
  end if;
  perform public.accounting_audit(v_org,v_event,v_doc_type,new.id,jsonb_build_object('branch_id',v_branch,'cost_journal_id',v_journal,'inventory_value',v_total));
  return new;
end $$;

create trigger sales_invoice_stock_effect after update of status on public.sales_invoices for each row execute function public.apply_document_stock_effect();
create trigger purchase_bill_stock_effect after update of status on public.purchase_bills for each row execute function public.apply_document_stock_effect();
create trigger sales_credit_note_stock_effect after update of status on public.sales_credit_notes for each row execute function public.apply_document_stock_effect();
create trigger purchase_debit_note_stock_effect after update of status on public.purchase_debit_notes for each row execute function public.apply_document_stock_effect();
revoke all on function public.apply_document_stock_effect() from public,anon,authenticated;

alter table public.stock_operations add column unit_cost numeric(24,10), add column inventory_value numeric(24,6), add column posted_journal_id uuid references public.journal_entries(id);
alter table public.stock_operations add constraint stock_operations_cost_check check(unit_cost is null or unit_cost>0);

drop function public.post_stock_operation(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,text,text,text);
create function public.post_stock_operation(
  p_operation_id uuid,p_organization_id uuid,p_branch_id uuid,p_operation_type public.stock_operation_type,p_transaction_date date,
  p_product_id uuid,p_source_location_id uuid,p_destination_location_id uuid,p_quantity numeric,p_unit_cost numeric default null,
  p_reference text default null,p_reason text default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_existing public.stock_operations%rowtype; v_product public.products%rowtype; v_source public.inventory_locations%rowtype; v_destination public.inventory_locations%rowtype;
  v_available numeric(20,4); v_key1 bigint; v_key2 bigint; v_inventory uuid; v_offset uuid; v_journal uuid; v_sm1 uuid; v_sm2 uuid; v_cost public.inventory_cost_events%rowtype; v_value numeric(24,6);
begin
  if v_user is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  if p_operation_id is null or p_quantity is null or p_quantity<=0 or p_transaction_date is null then raise exception 'A positive quantity and transaction date are required'; end if;
  if p_operation_type in ('opening','adjustment_in') and (p_unit_cost is null or p_unit_cost<=0) then raise exception 'A positive unit cost is required'; end if;
  if p_operation_type in ('adjustment_out','transfer') and p_unit_cost is not null then raise exception 'Unit cost is derived for outbound stock'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-operation:'||p_operation_id::text,0));
  select * into v_existing from public.stock_operations where id=p_operation_id;
  if found then
    if v_existing.organization_id<>p_organization_id or v_existing.created_by<>v_user then raise exception 'Operation id is already in use'; end if;
    return jsonb_build_object('operation_id',v_existing.id,'idempotent',true,'quantity',v_existing.quantity,'inventory_value',v_existing.inventory_value,'journal_id',v_existing.posted_journal_id);
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception 'Active branch not found'; end if;
  select * into v_product from public.products where id=p_product_id and organization_id=p_organization_id and status='active';
  if not found or v_product.kind<>'product' or not v_product.track_inventory then raise exception 'Active inventory-tracked product required'; end if;
  if p_operation_type in ('opening','adjustment_in','adjustment_out') then
    if p_source_location_id is null or p_destination_location_id is not null then raise exception 'One stock location is required'; end if;
    select * into v_source from public.inventory_locations where id=p_source_location_id and organization_id=p_organization_id and branch_id=p_branch_id and status='active'; if not found then raise exception 'Active stock location not found'; end if;
  else
    if p_source_location_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id then raise exception 'Different source and destination locations are required'; end if;
    select * into v_source from public.inventory_locations where id=p_source_location_id and organization_id=p_organization_id and status='active'; if not found then raise exception 'Active source location not found'; end if;
    select * into v_destination from public.inventory_locations where id=p_destination_location_id and organization_id=p_organization_id and status='active'; if not found then raise exception 'Active destination location not found'; end if;
    if v_source.branch_id<>p_branch_id then raise exception 'Source location must belong to selected branch'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-cost:'||p_organization_id::text||':'||p_product_id::text,0));
  v_key1:=hashtextextended(p_organization_id::text||':'||p_product_id::text||':'||p_source_location_id::text,0);
  if p_operation_type='transfer' then v_key2:=hashtextextended(p_organization_id::text||':'||p_product_id::text||':'||p_destination_location_id::text,0); if v_key1<v_key2 then perform pg_advisory_xact_lock(v_key1); perform pg_advisory_xact_lock(v_key2); else perform pg_advisory_xact_lock(v_key2); perform pg_advisory_xact_lock(v_key1); end if; else perform pg_advisory_xact_lock(v_key1); end if;
  if p_operation_type in ('adjustment_out','transfer') then select coalesce(sum(signed_quantity),0) into v_available from public.stock_movements where organization_id=p_organization_id and product_id=p_product_id and location_id=p_source_location_id; if v_available<p_quantity then raise exception 'Insufficient stock: available %, requested %',v_available,p_quantity; end if; end if;
  select id into v_inventory from public.accounts where organization_id=p_organization_id and system_key='inventory' and is_active;
  if p_operation_type='opening' then select id into v_offset from public.accounts where organization_id=p_organization_id and system_key='owner_capital' and is_active; else select id into v_offset from public.accounts where organization_id=p_organization_id and system_key='inventory_adjustment' and is_active; end if;
  if v_inventory is null or (p_operation_type<>'transfer' and v_offset is null) then raise exception 'inventory_system_account_missing'; end if;
  if p_operation_type<>'transfer' then v_journal:=gen_random_uuid(); insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,reference,description,created_by) values(v_journal,p_organization_id,p_branch_id,p_transaction_date,'inventory_cost',p_operation_id,nullif(trim(p_reference),''),'Inventory '||replace(p_operation_type::text,'_',' '),v_user); end if;
  if p_operation_type='opening' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'opening',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user) returning id into v_sm1;
    v_value:=round(p_quantity*p_unit_cost,6); v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_transaction_date,'opening',p_quantity,v_value,v_sm1,'stock_operation',p_operation_id,null,null,v_journal,p_reference);
  elsif p_operation_type='adjustment_in' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'adjustment_in',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user) returning id into v_sm1;
    v_value:=round(p_quantity*p_unit_cost,6); v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_transaction_date,'adjustment_in',p_quantity,v_value,v_sm1,'stock_operation',p_operation_id,null,null,v_journal,p_reference);
  elsif p_operation_type='adjustment_out' then
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values(p_organization_id,p_branch_id,p_source_location_id,p_product_id,p_transaction_date,'adjustment_out',-p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user) returning id into v_sm1;
    v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_transaction_date,'adjustment_out',-p_quantity,null,v_sm1,'stock_operation',p_operation_id,null,null,v_journal,p_reference); v_value:=-v_cost.value_delta;
  else
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values(p_organization_id,v_source.branch_id,p_source_location_id,p_product_id,p_transaction_date,'transfer_out',-p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user) returning id into v_sm1;
    v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_transaction_date,'transfer_out',-p_quantity,null,v_sm1,'stock_operation',p_operation_id,null,null,null,p_reference); v_value:=-v_cost.value_delta;
    insert into public.stock_movements(organization_id,branch_id,location_id,product_id,transaction_date,movement_type,signed_quantity,source_document_type,source_document_id,reference,notes,created_by) values(p_organization_id,v_destination.branch_id,p_destination_location_id,p_product_id,p_transaction_date,'transfer_in',p_quantity,'stock_operation',p_operation_id,p_reference,p_notes,v_user) returning id into v_sm2;
    v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_transaction_date,'transfer_in',p_quantity,v_value,v_sm2,'stock_operation',p_operation_id,null,null,null,p_reference);
  end if;
  insert into public.stock_operations(id,organization_id,branch_id,operation_type,transaction_date,product_id,source_location_id,destination_location_id,quantity,unit_cost,inventory_value,reference,reason,notes,posted_journal_id,created_by) values(p_operation_id,p_organization_id,p_branch_id,p_operation_type,p_transaction_date,p_product_id,p_source_location_id,p_destination_location_id,p_quantity,coalesce(p_unit_cost,v_cost.unit_cost),v_value,nullif(trim(p_reference),''),nullif(trim(p_reason),''),nullif(trim(p_notes),''),v_journal,v_user);
  if p_operation_type<>'transfer' then
    if p_operation_type in ('opening','adjustment_in') then insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,1,v_inventory,'Inventory value',v_value,0,p_branch_id),(p_organization_id,v_journal,2,v_offset,'Inventory offset',0,v_value,p_branch_id); else insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,1,v_offset,'Inventory adjustment',v_value,0,p_branch_id),(p_organization_id,v_journal,2,v_inventory,'Inventory value',0,v_value,p_branch_id); end if;
    perform public.post_journal_entry(p_organization_id,v_journal);
  end if;
  perform public.accounting_audit(p_organization_id,'inventory.stock_operation.costed','stock_operation',p_operation_id,jsonb_build_object('type',p_operation_type,'product_id',p_product_id,'quantity',p_quantity,'inventory_value',v_value,'journal_id',v_journal));
  return jsonb_build_object('operation_id',p_operation_id,'idempotent',false,'quantity',p_quantity,'inventory_value',v_value,'journal_id',v_journal);
end $$;
revoke all on function public.post_stock_operation(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,numeric,text,text,text) from public,anon;
grant execute on function public.post_stock_operation(uuid,uuid,uuid,public.stock_operation_type,date,uuid,uuid,uuid,numeric,numeric,text,text,text) to authenticated;

create function public.get_inventory_valuation_report(p_organization_id uuid,p_product_id uuid default null)
returns table(product_id uuid,product_name text,sku text,quantity_on_hand numeric,average_unit_cost numeric,inventory_value numeric,valuation_status text,last_costed_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query select p.id,p.name,p.sku,coalesce(q.quantity,0)::numeric,coalesce(c.resulting_average_cost,0)::numeric,coalesce(c.resulting_value,0)::numeric,
    case when coalesce(q.quantity,0)<>coalesce(c.resulting_quantity,0) then 'valuation_required' else 'costed' end,c.created_at
  from public.products p
  left join lateral(select sum(m.signed_quantity)::numeric quantity from public.stock_movements m where m.organization_id=p_organization_id and m.product_id=p.id) q on true
  left join lateral(select e.resulting_quantity,e.resulting_average_cost,e.resulting_value,e.created_at from public.inventory_cost_events e where e.organization_id=p_organization_id and e.product_id=p.id order by e.sequence desc limit 1) c on true
  where p.organization_id=p_organization_id and p.kind='product' and p.track_inventory and (p_product_id is null or p.id=p_product_id)
  order by p.name,p.id;
end $$;

create function public.get_inventory_cogs_report(p_organization_id uuid,p_from date default null,p_to date default null,p_product_id uuid default null)
returns table(id uuid,event_date date,event_type text,product_id uuid,product_name text,sku text,quantity numeric,unit_cost numeric,cogs_amount numeric,reference text,source_document_type text,source_document_id uuid,journal_entry_id uuid,journal_number text,created_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query select e.id,e.event_date,e.event_type,e.product_id,p.name,p.sku,abs(e.quantity_delta)::numeric,e.unit_cost::numeric,
    (case when e.event_type='sale' then -e.value_delta else e.value_delta end)::numeric,e.reference,e.source_document_type,e.source_document_id,e.journal_entry_id,j.journal_number,e.created_at
  from public.inventory_cost_events e join public.products p on p.id=e.product_id left join public.journal_entries j on j.id=e.journal_entry_id
  where e.organization_id=p_organization_id and e.event_type in ('sale','sales_return') and (p_from is null or e.event_date>=p_from) and (p_to is null or e.event_date<=p_to) and (p_product_id is null or e.product_id=p_product_id)
  order by e.event_date desc,e.sequence desc;
end $$;

drop function public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type);
create function public.get_stock_movement_report(p_organization_id uuid,p_branch_id uuid default null,p_product_id uuid default null,p_location_id uuid default null,p_from date default null,p_to date default null,p_movement_type public.inventory_movement_type default null)
returns table(id uuid,transaction_date date,movement_type public.inventory_movement_type,signed_quantity numeric,running_quantity numeric,unit_cost numeric,movement_value numeric,reference text,notes text,created_at timestamptz,product_id uuid,product_name text,sku text,location_id uuid,location_name text,branch_id uuid,source_document_type text,source_document_id uuid,source_document_line_id uuid,journal_entry_id uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query with ordered as (
    select m.id,m.transaction_date,m.movement_type,m.signed_quantity,sum(m.signed_quantity) over(partition by m.product_id,m.location_id order by m.transaction_date,m.created_at,m.id rows unbounded preceding)::numeric running_quantity,
      e.unit_cost::numeric,e.value_delta::numeric movement_value,m.reference,m.notes,m.created_at,m.product_id,p.name product_name,p.sku,m.location_id,l.name location_name,m.branch_id,m.source_document_type,m.source_document_id,m.source_document_line_id,e.journal_entry_id
    from public.stock_movements m join public.products p on p.id=m.product_id join public.inventory_locations l on l.id=m.location_id left join public.inventory_cost_events e on e.stock_movement_id=m.id
    where m.organization_id=p_organization_id and (p_branch_id is null or m.branch_id=p_branch_id) and (p_product_id is null or m.product_id=p_product_id) and (p_location_id is null or m.location_id=p_location_id)
  ) select o.* from ordered o where (p_from is null or o.transaction_date>=p_from) and (p_to is null or o.transaction_date<=p_to) and (p_movement_type is null or o.movement_type=p_movement_type) order by o.transaction_date desc,o.created_at desc,o.id desc limit 1000;
end $$;

revoke all on function public.get_inventory_valuation_report(uuid,uuid),public.get_inventory_cogs_report(uuid,date,date,uuid),public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) from public,anon;
grant execute on function public.get_inventory_valuation_report(uuid,uuid),public.get_inventory_cogs_report(uuid,date,date,uuid),public.get_stock_movement_report(uuid,uuid,uuid,uuid,date,date,public.inventory_movement_type) to authenticated;

create function public.initialize_inventory_valuation(p_initialization_id uuid,p_organization_id uuid,p_product_id uuid,p_date date,p_unit_cost numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_existing public.inventory_cost_events%rowtype; v_quantity numeric(20,4); v_value numeric(24,6); v_inventory uuid; v_equity uuid; v_journal uuid:=gen_random_uuid(); v_cost public.inventory_cost_events%rowtype;
begin
  perform public.assert_accounting_owner(p_organization_id);
  if p_initialization_id is null or p_date is null or p_unit_cost is null or p_unit_cost<=0 then raise exception 'invalid_valuation_initialization'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-valuation-init:'||p_initialization_id::text,0));
  select * into v_existing from public.inventory_cost_events where organization_id=p_organization_id and source_document_type='valuation_initialization' and source_document_id=p_initialization_id limit 1;
  if found then return jsonb_build_object('initialization_id',p_initialization_id,'journal_id',v_existing.journal_entry_id,'idempotent',true); end if;
  if exists(select 1 from public.inventory_cost_events where organization_id=p_organization_id and product_id=p_product_id) then raise exception 'inventory_valuation_already_initialized'; end if;
  select coalesce(sum(signed_quantity),0) into v_quantity from public.stock_movements where organization_id=p_organization_id and product_id=p_product_id;
  if v_quantity<=0 then raise exception 'positive_legacy_quantity_required'; end if;
  v_value:=round(v_quantity*p_unit_cost,6);
  select id into v_inventory from public.accounts where organization_id=p_organization_id and system_key='inventory' and is_active;
  select id into v_equity from public.accounts where organization_id=p_organization_id and system_key='owner_capital' and is_active;
  if v_inventory is null or v_equity is null then raise exception 'inventory_system_account_missing'; end if;
  insert into public.journal_entries(id,organization_id,journal_date,source_type,source_id,description,created_by) values(v_journal,p_organization_id,p_date,'inventory_cost',p_initialization_id,'Initialize legacy inventory valuation',auth.uid());
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount) values(p_organization_id,v_journal,1,v_inventory,'Legacy inventory value',v_value,0),(p_organization_id,v_journal,2,v_equity,'Legacy inventory valuation offset',0,v_value);
  v_cost:=public.record_inventory_cost_event(p_organization_id,p_product_id,p_date,'opening',v_quantity,v_value,null,'valuation_initialization',p_initialization_id,null,null,v_journal,'Valuation initialization');
  perform public.post_journal_entry(p_organization_id,v_journal);
  perform public.accounting_audit(p_organization_id,'inventory.valuation.initialized','product',p_product_id,jsonb_build_object('quantity',v_quantity,'unit_cost',p_unit_cost,'inventory_value',v_value,'journal_id',v_journal));
  return jsonb_build_object('initialization_id',p_initialization_id,'journal_id',v_journal,'quantity',v_quantity,'inventory_value',v_value,'idempotent',false);
end $$;
revoke all on function public.initialize_inventory_valuation(uuid,uuid,uuid,date,numeric) from public,anon;
grant execute on function public.initialize_inventory_valuation(uuid,uuid,uuid,date,numeric) to authenticated;

create or replace function public.initialize_inventory_foundation(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_branch record;
begin
  if v_user is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  insert into public.inventory_units(organization_id,code,name,created_by) values
    (p_organization_id,'NOS','Numbers',v_user),(p_organization_id,'PCS','Pieces',v_user),(p_organization_id,'KG','Kilograms',v_user),(p_organization_id,'G','Grams',v_user),(p_organization_id,'L','Litres',v_user),(p_organization_id,'ML','Millilitres',v_user),(p_organization_id,'BOX','Boxes',v_user),(p_organization_id,'PACK','Packs',v_user)
  on conflict (organization_id,code) do nothing;
  for v_branch in select id,name from public.branches where organization_id=p_organization_id and status='active' loop
    if not exists(select 1 from public.inventory_locations where branch_id=v_branch.id and is_default and status='active') then
      insert into public.inventory_locations(organization_id,branch_id,name,code,is_default,created_by) values(p_organization_id,v_branch.id,v_branch.name||' Main Stock','MAIN',true,v_user)
      on conflict (organization_id,branch_id,code) do update set is_default=true,status='active';
    end if;
  end loop;
  if not exists(select 1 from public.accounts where organization_id=p_organization_id and system_key='inventory_adjustment') and exists(select 1 from public.account_groups where organization_id=p_organization_id and system_key='cost_of_sales') then
    insert into public.accounts(organization_id,account_group_id,code,name,account_type,system_key,is_system,allow_manual_posting)
    select p_organization_id,g.id,(select to_char(n,'FM0000') from generate_series(5001,5999)n where not exists(select 1 from public.accounts a where a.organization_id=p_organization_id and a.code=to_char(n,'FM0000')) order by n limit 1),'Inventory Adjustments','expense','inventory_adjustment',true,false
    from public.account_groups g where g.organization_id=p_organization_id and g.system_key='cost_of_sales';
  end if;
  return jsonb_build_object('initialized',true);
end $$;
