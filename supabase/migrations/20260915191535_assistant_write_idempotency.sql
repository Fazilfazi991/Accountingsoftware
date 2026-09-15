-- Assistant write requests are claimed and completed in the same transaction as
-- the existing domain RPC. An exception rolls both the claim and business write back.
create table public.write_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  request_key uuid not null,
  payload jsonb not null,
  status text not null default 'processing' check (status in ('processing','succeeded')),
  resource_type text,
  resource_id uuid,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint write_requests_completed_result check (
    (status='processing' and resource_id is null and result is null and completed_at is null)
    or (status='succeeded' and resource_type is not null and resource_id is not null
        and result is not null and completed_at is not null)),
  constraint write_requests_scope_key unique (organization_id,action,request_key)
);
create index write_requests_branch_idx on public.write_requests(branch_id);
create index write_requests_actor_idx on public.write_requests(actor_user_id);

alter table public.write_requests enable row level security;
revoke all on public.write_requests from public,anon,authenticated;

-- Keep privileged implementation outside exposed Data API schemas. The public
-- RPC is only an invoker entry point and has no direct table privileges.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.execute_assistant_write_internal(
  p_org uuid,p_branch uuid,p_action text,p_request_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_capability text;
  v_claimed boolean;
  v_existing public.write_requests%rowtype;
  v_id uuid;
  v_lines jsonb;
  v_result jsonb;
  v_number text;
  v_status text;
  v_line jsonb;
  v_source_lines jsonb;
begin
  v_capability := case p_action
    when 'create_invoice_draft' then 'sales.create'
    when 'create_quotation_draft' then 'accounting.setup.manage'
    when 'create_customer' then 'masters.manage'
    else null end;
  if v_actor is null or v_capability is null or p_org is null or p_branch is null
     or p_request_key is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'invalid_assistant_write_request';
  end if;
  -- Authorization is checked on EVERY call, including replay after a role change.
  perform public.assert_org_capability(p_org,v_capability);
  if not exists (select 1 from public.branches b
                 where b.id=p_branch and b.organization_id=p_org and b.status='active') then
    raise exception 'invalid_assistant_branch';
  end if;

  -- The unique index serializes two simultaneous requests. ON CONFLICT waits for
  -- the winner's transaction; a failed winner rolls back, permitting a retry.
  insert into public.write_requests(organization_id,branch_id,actor_user_id,
                                    action,request_key,payload)
  values(p_org,p_branch,v_actor,p_action,p_request_key,p_payload)
  on conflict (organization_id,action,request_key) do nothing;
  v_claimed := found;
  if not v_claimed then
    select * into v_existing from public.write_requests
      where organization_id=p_org and action=p_action and request_key=p_request_key;
    if not found then raise exception 'assistant_write_retry_required'; end if;
    if v_existing.branch_id<>p_branch or v_existing.actor_user_id<>v_actor then
      raise exception 'assistant_write_scope_mismatch';
    end if;
    if v_existing.payload<>p_payload then
      raise exception 'assistant_write_payload_mismatch';
    end if;
    if v_existing.status<>'succeeded' or v_existing.result is null then
      raise exception 'assistant_write_retry_required';
    end if;
    return v_existing.result;
  end if;

  if p_action in ('create_invoice_draft','create_quotation_draft') then
    v_source_lines := case when p_action='create_invoice_draft'
      then p_payload->'items' else p_payload->'lines' end;
    if jsonb_typeof(v_source_lines)<>'array' then raise exception 'invalid_assistant_lines'; end if;
    for v_line in select value from jsonb_array_elements(v_source_lines) loop
      if not exists (select 1 from public.products p where p.id=(v_line->>'productId')::uuid
                     and p.organization_id=p_org and p.status='active')
         or not exists (select 1 from public.accounts a where a.id=(v_line->>'accountId')::uuid
                        and a.organization_id=p_org and a.is_active and a.account_type='income')
         or (nullif(v_line->>'taxRateId','') is not null
             and not exists (select 1 from public.tax_rates t
                             where t.id=(v_line->>'taxRateId')::uuid
                               and t.organization_id=p_org and t.is_active and t.sales_enabled)) then
        raise exception 'invalid_assistant_line_scope';
      end if;
    end loop;
  end if;

  if p_action='create_invoice_draft' then
    if jsonb_typeof(p_payload->'items')<>'array'
       or jsonb_array_length(p_payload->'items')=0 then raise exception 'invalid_invoice_lines'; end if;
    select jsonb_agg(jsonb_build_object(
      'product_id',(x->>'productId')::uuid,'description',x->>'description',
      'quantity',(x->>'quantity')::numeric,'unit_price',(x->>'unitPrice')::numeric,
      'discount',(x->>'discount')::numeric,'revenue_account_id',(x->>'accountId')::uuid,
      'tax_rate_id',nullif(x->>'taxRateId','')::uuid,
      'inventory_location_id',nullif(x->>'locationId','')::uuid)) into v_lines
      from jsonb_array_elements(p_payload->'items') x;
    v_id := public.create_sales_invoice_draft(
      p_org,(p_payload->>'customerId')::uuid,(p_payload->>'documentDate')::date,
      (p_payload->>'dueDate')::date,v_lines,p_branch,
      p_payload->>'reference',p_payload->>'notes');
    v_result := jsonb_build_object('id',v_id,'status','draft');
  elsif p_action='create_quotation_draft' then
    if jsonb_typeof(p_payload->'lines')<>'array'
       or jsonb_array_length(p_payload->'lines')=0 then raise exception 'invalid_quotation_lines'; end if;
    select jsonb_agg(jsonb_build_object(
      'product_id',(x->>'productId')::uuid,'description',x->>'description',
      'quantity',(x->>'quantity')::numeric,'unit_price',(x->>'unitPrice')::numeric,
      'discount',(x->>'discount')::numeric,'revenue_account_id',(x->>'accountId')::uuid,
      'tax_rate_id',nullif(x->>'taxRateId','')::uuid)) into v_lines
      from jsonb_array_elements(p_payload->'lines') x;
    v_id := public.save_operational_document(
      p_org,'quotation',null,(p_payload->>'customerId')::uuid,p_branch,
      (p_payload->>'date')::date,(p_payload->>'expiry')::date,
      p_payload->>'reference',p_payload->>'notes',v_lines);
    select quotation_number,status::text into v_number,v_status from public.sales_quotations
      where id=v_id and organization_id=p_org and branch_id=p_branch;
    if v_number is null then raise exception 'assistant_quotation_result_missing'; end if;
    v_result := jsonb_build_object('id',v_id,'number',v_number,'status',v_status);
  else
    -- Keep the V1.1 Assistant exact-name guard for a NEW claim. A replay above
    -- returns its original result before reaching this check.
    if exists (select 1 from public.customers c where c.organization_id=p_org
               and c.name=trim(p_payload->>'name')) then
      raise exception 'assistant_customer_name_exists';
    end if;
    v_id := public.save_party(
      p_org,'customer',null,p_payload->>'name',p_payload->>'trn',
      p_payload->>'email',p_payload->>'phone',p_payload->>'address',
      (p_payload->>'paymentTermsDays')::integer,true);
    v_result := jsonb_build_object('id',v_id,'name',trim(p_payload->>'name'),
      'email',coalesce(p_payload->>'email',''),'phone',coalesce(p_payload->>'phone',''),
      'trn',coalesce(p_payload->>'trn',''));
  end if;

  update public.write_requests set status='succeeded',resource_type=p_action,
    resource_id=v_id,result=v_result,completed_at=now()
    where organization_id=p_org and action=p_action and request_key=p_request_key;
  return v_result;
end $$;

revoke all on function private.execute_assistant_write_internal(uuid,uuid,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function private.execute_assistant_write_internal(uuid,uuid,text,uuid,jsonb)
  to authenticated;

create or replace function public.execute_assistant_write(
  p_org uuid,p_branch uuid,p_action text,p_request_key uuid,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.execute_assistant_write_internal(p_org,p_branch,p_action,p_request_key,p_payload)
$$;

revoke all on function public.execute_assistant_write(uuid,uuid,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.execute_assistant_write(uuid,uuid,text,uuid,jsonb)
  to authenticated;

-- Read the prior result before mutable choice checks. It is not a claim and
-- never authorizes a write; the transactional executor still owns concurrency.
create or replace function private.lookup_assistant_write_internal(
  p_org uuid,p_branch uuid,p_action text,p_request_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_capability text; v_actor uuid:=auth.uid(); v_existing public.write_requests%rowtype;
begin
  v_capability := case p_action
    when 'create_invoice_draft' then 'sales.create'
    when 'create_quotation_draft' then 'accounting.setup.manage'
    when 'create_customer' then 'masters.manage' else null end;
  if v_actor is null or v_capability is null or p_org is null or p_branch is null
     or p_request_key is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'invalid_assistant_write_request';
  end if;
  perform public.assert_org_capability(p_org,v_capability);
  select * into v_existing from public.write_requests
    where organization_id=p_org and action=p_action and request_key=p_request_key;
  if not found then return null; end if;
  if v_existing.branch_id<>p_branch or v_existing.actor_user_id<>v_actor then
    raise exception 'assistant_write_scope_mismatch';
  end if;
  if v_existing.payload<>p_payload then raise exception 'assistant_write_payload_mismatch'; end if;
  if v_existing.status<>'succeeded' then raise exception 'assistant_write_retry_required'; end if;
  return v_existing.result;
end $$;

revoke all on function private.lookup_assistant_write_internal(uuid,uuid,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function private.lookup_assistant_write_internal(uuid,uuid,text,uuid,jsonb)
  to authenticated;
create or replace function public.lookup_assistant_write(
  p_org uuid,p_branch uuid,p_action text,p_request_key uuid,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lookup_assistant_write_internal(p_org,p_branch,p_action,p_request_key,p_payload)
$$;
revoke all on function public.lookup_assistant_write(uuid,uuid,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.lookup_assistant_write(uuid,uuid,text,uuid,jsonb)
  to authenticated;
