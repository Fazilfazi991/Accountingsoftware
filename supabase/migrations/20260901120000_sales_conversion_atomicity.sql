-- QA corrective migration: serialize source consumption and make converted
-- invoice creation + allocation recording one database transaction.

create or replace function public.record_document_conversions(
  p_org uuid,
  p_target_type public.conversion_target_type,
  p_target_id uuid,
  p_allocations jsonb
) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  x jsonb; v_source_type public.conversion_source_type; v_source_doc uuid;
  v_source_line uuid; v_qty numeric; v_remaining numeric;
  v_customer uuid; v_branch uuid; v_target_customer uuid; v_target_branch uuid;
  v_lock record;
begin
  perform public.assert_accounting_owner(p_org);
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then
    raise exception 'invalid_allocations';
  end if;

  -- A stable lock order avoids both over-consumption races and deadlocks when
  -- two requests contain the same set of source lines in a different order.
  for v_lock in
    select distinct (value->>'source_type') source_type,
      (value->>'source_line_id')::uuid source_line_id
    from jsonb_array_elements(p_allocations)
    order by 1,2
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      p_org::text||':'||v_lock.source_type||':'||v_lock.source_line_id::text,0));
  end loop;

  if p_target_type='sales_invoice' then
    select customer_id,branch_id into v_target_customer,v_target_branch
    from public.sales_invoices
    where id=p_target_id and organization_id=p_org and status='draft';
  else
    select customer_id,branch_id into v_target_customer,v_target_branch
    from public.delivery_notes where id=p_target_id and organization_id=p_org;
  end if;
  if v_target_customer is null then raise exception 'target_not_editable'; end if;

  delete from public.document_conversion_lines
  where organization_id=p_org and target_type=p_target_type
    and target_document_id=p_target_id;

  for x in select value from jsonb_array_elements(p_allocations) loop
    v_source_type:=(x->>'source_type')::public.conversion_source_type;
    v_source_doc:=(x->>'source_document_id')::uuid;
    v_source_line:=(x->>'source_line_id')::uuid;
    v_qty:=(x->>'quantity')::numeric;
    if v_source_type='quotation' then
      select customer_id,branch_id into v_customer,v_branch
      from public.sales_quotations where id=v_source_doc and organization_id=p_org;
      if not exists(select 1 from public.sales_quotation_lines where id=v_source_line and quotation_id=v_source_doc and organization_id=p_org) then
        raise exception 'invalid_source_line';
      end if;
    else
      select customer_id,branch_id into v_customer,v_branch
      from public.delivery_notes where id=v_source_doc and organization_id=p_org;
      if not exists(select 1 from public.delivery_note_lines where id=v_source_line and delivery_note_id=v_source_doc and organization_id=p_org) then
        raise exception 'invalid_source_line';
      end if;
    end if;
    if v_customer is distinct from v_target_customer or v_branch is distinct from v_target_branch then
      raise exception 'incompatible_source_documents';
    end if;
    v_remaining:=public.source_line_remaining(p_org,v_source_type,v_source_line);
    if v_qty<=0 or v_qty>v_remaining then
      raise exception 'over_conversion: remaining % requested %',v_remaining,v_qty;
    end if;
    insert into public.document_conversion_lines(
      organization_id,source_type,source_document_id,source_line_id,
      target_type,target_document_id,quantity,created_by)
    values(p_org,v_source_type,v_source_doc,v_source_line,
      p_target_type,p_target_id,v_qty,auth.uid());
  end loop;
  perform public.accounting_audit(p_org,'document.conversion_recorded',
    p_target_type::text,p_target_id,jsonb_build_object('allocations',p_allocations));
end $$;

create or replace function public.create_converted_sales_invoice_draft(
  p_organization_id uuid,p_customer_id uuid,p_invoice_date date,p_due_date date,
  p_lines jsonb,p_allocations jsonb,p_branch_id uuid default null,
  p_reference text default null,p_notes text default null
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  -- Both calls execute inside this RPC transaction. Any allocation validation,
  -- compatibility, or over-conversion failure rolls the invoice draft back.
  v_id:=public.create_sales_invoice_draft(p_organization_id,p_customer_id,
    p_invoice_date,p_due_date,p_lines,p_branch_id,p_reference,p_notes);
  perform public.record_document_conversions(p_organization_id,'sales_invoice',v_id,p_allocations);
  return v_id;
end $$;

revoke all on function public.create_converted_sales_invoice_draft(uuid,uuid,date,date,jsonb,jsonb,uuid,text,text) from public,anon;
grant execute on function public.create_converted_sales_invoice_draft(uuid,uuid,date,date,jsonb,jsonb,uuid,text,text) to authenticated;

create or replace function public.create_converted_delivery_note(
  p_org uuid,
  p_customer uuid,
  p_branch uuid,
  p_date date,
  p_reference text,
  p_notes text,
  p_lines jsonb,
  p_allocations jsonb
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'conversion_allocations_required';
  end if;

  v_id := public.save_operational_document(
    p_org,
    'delivery_note',
    null,
    p_customer,
    p_branch,
    p_date,
    null,
    p_reference,
    p_notes,
    p_lines
  );

  perform public.record_document_conversions(
    p_org,
    'delivery_note',
    v_id,
    p_allocations
  );

  return v_id;
end;
$$;

revoke all on function public.create_converted_delivery_note(uuid,uuid,uuid,date,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.create_converted_delivery_note(uuid,uuid,uuid,date,text,text,jsonb,jsonb) to authenticated;
