create or replace function public.get_inventory_cogs_report(p_organization_id uuid,p_from date default null,p_to date default null,p_product_id uuid default null)
returns table(id uuid,event_date date,event_type text,product_id uuid,product_name text,sku text,quantity numeric,unit_cost numeric,cogs_amount numeric,reference text,source_document_type text,source_document_id uuid,journal_entry_id uuid,journal_number text,created_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then raise exception 'Active organization membership required'; end if;
  return query select e.id,e.event_date,e.event_type,e.product_id,p.name,p.sku,abs(e.quantity_delta)::numeric,e.unit_cost::numeric,
    (-e.value_delta)::numeric,e.reference,e.source_document_type,e.source_document_id,e.journal_entry_id,j.journal_number,e.created_at
  from public.inventory_cost_events e join public.products p on p.id=e.product_id left join public.journal_entries j on j.id=e.journal_entry_id
  where e.organization_id=p_organization_id and e.event_type in ('sale','sales_return') and (p_from is null or e.event_date>=p_from) and (p_to is null or e.event_date<=p_to) and (p_product_id is null or e.product_id=p_product_id)
  order by e.event_date desc,e.sequence desc;
end $$;

revoke all on function public.get_inventory_cogs_report(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_inventory_cogs_report(uuid,date,date,uuid) to authenticated;
