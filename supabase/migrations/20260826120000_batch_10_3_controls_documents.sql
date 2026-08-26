-- Batch 10.3: production audit, role controls, settings and master-data polish.

create type public.membership_role as enum ('owner','admin','accountant','staff','viewer');

alter table public.organization_memberships
  add column role public.membership_role;
update public.organization_memberships set role=case when is_owner then 'owner'::public.membership_role else 'staff'::public.membership_role end where role is null;
alter table public.organization_memberships alter column role set not null;

alter table public.organizations
  add column trn text,
  add column email text,
  add column phone text,
  add column address text,
  add column emirate text not null default 'Dubai',
  add column country_code text not null default 'AE';

alter table public.branches
  add column address text,
  add column email text,
  add column phone text,
  add column default_inventory_location_id uuid references public.inventory_locations(id);

create index audit_events_org_type_created_idx on public.audit_events(organization_id,event_type,created_at desc);
create index audit_events_org_actor_created_idx on public.audit_events(organization_id,actor_user_id,created_at desc);

create or replace function public.current_org_role(p_org uuid) returns public.membership_role
language sql stable security definer set search_path=pg_catalog,public as $$
  select case when m.is_owner then 'owner'::public.membership_role else m.role end
  from public.organization_memberships m
  where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.membership_status='active'
$$;

create or replace function public.has_org_capability(p_org uuid,p_capability text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  with r as (select public.current_org_role(p_org) role)
  select coalesce(case
    when role in ('owner','admin') then true
    when role='accountant' then p_capability=any(array['accounting.setup.manage','masters.manage','sales.create','sales.post','purchases.create','purchases.post','settlements.create','expenses.create','inventory.manage','journals.create','journals.post','reports.view','audit.view'])
    when role='staff' then p_capability=any(array['masters.manage','sales.create','purchases.create','settlements.create','expenses.create','reports.view'])
    when role='viewer' then p_capability='reports.view'
    else false end,false) from r
$$;

create or replace function public.assert_org_capability(p_org uuid,p_capability text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if (select auth.uid()) is null or not public.has_org_capability(p_org,p_capability) then raise exception 'not_authorized'; end if;
end $$;

create or replace function public.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(public.current_org_role(p_org) in ('owner','admin'),false)
$$;

-- Existing accounting functions use this guard. Accountants may operate accounting;
-- Staff/Viewer cannot post or mutate through those security-definer RPCs.
create or replace function public.assert_accounting_owner(p_organization_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform public.assert_org_capability(p_organization_id,'accounting.setup.manage'); end $$;

-- Draft entry is intentionally less privileged than posting. Rebuild only the
-- named draft RPCs, replacing their legacy accountant-only assertion in place.
do $$ declare f record; v_sql text; v_capability text;
begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'create_sales_invoice_draft','update_sales_invoice_draft','delete_sales_invoice_draft',
      'replace_sales_invoice_lines',
      'create_purchase_bill_draft','update_purchase_bill_draft','delete_purchase_bill_draft',
      'replace_purchase_bill_lines',
      'create_sales_credit_note_draft','update_sales_credit_note_draft','delete_sales_credit_note_draft',
      'replace_sales_credit_note_lines',
      'create_customer_receipt_draft','update_customer_receipt_draft','delete_customer_receipt_draft',
      'create_purchase_debit_note_draft','update_purchase_debit_note_draft','delete_purchase_debit_note_draft',
      'replace_purchase_debit_note_lines',
      'create_supplier_payment_draft','update_supplier_payment_draft','delete_supplier_payment_draft',
      'create_expense_draft','update_expense_draft','delete_expense_draft'])
  loop
    v_capability:=case when f.proname like '%sales_invoice%' then 'sales.create' when f.proname like '%purchase_bill%' then 'purchases.create' when f.proname like '%expense%' then 'expenses.create' else 'settlements.create' end;
    v_sql:=pg_get_functiondef(f.oid);
    v_sql:=regexp_replace(v_sql,'perform\s+public\.assert_accounting_owner\(p_organization_id\);',format('perform public.assert_org_capability(p_organization_id,%L);',v_capability),'gi');
    execute v_sql;
  end loop;
end $$;

create or replace function public.assert_settlement_cash_account(p_organization_id uuid,p_account_id uuid,p_branch_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.assert_org_capability(p_organization_id,'settlements.create');
  if not exists(select 1 from public.accounts a where a.id=p_account_id and a.organization_id=p_organization_id and a.is_active and ((a.account_type='cash' and exists(select 1 from public.cash_accounts c where c.organization_id=p_organization_id and c.account_id=a.id and c.is_active and (p_branch_id is null or c.branch_id is null or c.branch_id=p_branch_id))) or (a.account_type='bank' and exists(select 1 from public.bank_accounts b where b.organization_id=p_organization_id and b.account_id=a.id and b.is_active and (p_branch_id is null or b.branch_id is null or b.branch_id=p_branch_id))))) then raise exception 'invalid_cash_or_bank_account'; end if;
end $$;

revoke all on function public.current_org_role(uuid),public.has_org_capability(uuid,text),public.assert_org_capability(uuid,text) from public,anon;
grant execute on function public.current_org_role(uuid),public.has_org_capability(uuid,text) to authenticated;

create or replace function public.update_company_profile(
  p_organization_id uuid,p_name text,p_legal_name text,p_trn text,p_email text,p_phone text,
  p_address text,p_emirate text,p_country_code text,p_currency text,p_timezone text
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.assert_org_capability(p_organization_id,'organization.manage');
  if coalesce(trim(p_name),'')='' or p_currency<>'AED' or coalesce(trim(p_timezone),'')='' or upper(trim(p_country_code))<>'AE' then raise exception 'invalid_input'; end if;
  update public.organizations set name=trim(p_name),legal_name=nullif(trim(p_legal_name),''),trn=nullif(trim(p_trn),''),email=nullif(trim(p_email),''),phone=nullif(trim(p_phone),''),address=nullif(trim(p_address),''),emirate=coalesce(nullif(trim(p_emirate),''),'Dubai'),country_code='AE',base_currency='AED',timezone=trim(p_timezone) where id=p_organization_id;
  perform public.accounting_audit(p_organization_id,'organization.settings_updated','organization',p_organization_id);
end $$;

create or replace function public.save_organization_branch(
  p_organization_id uuid,p_branch_id uuid,p_name text,p_code text,p_address text,p_email text,p_phone text,
  p_status public.entity_status,p_default_inventory_location_id uuid default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_branch_id,gen_random_uuid());
begin
  perform public.assert_org_capability(p_organization_id,'organization.manage');
  if coalesce(trim(p_name),'')='' then raise exception 'invalid_input'; end if;
  if p_status='inactive' and p_branch_id is not null and (select count(*) from public.branches where organization_id=p_organization_id and status='active')<=1 and exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception 'last_active_branch'; end if;
  if p_default_inventory_location_id is not null and not exists(select 1 from public.inventory_locations where id=p_default_inventory_location_id and organization_id=p_organization_id and branch_id=p_branch_id and status='active') then raise exception 'invalid_default_location'; end if;
  insert into public.branches(id,organization_id,name,code,address,email,phone,status,default_inventory_location_id)
  values(v_id,p_organization_id,trim(p_name),nullif(upper(trim(p_code)),''),nullif(trim(p_address),''),nullif(trim(p_email),''),nullif(trim(p_phone),''),p_status,p_default_inventory_location_id)
  on conflict(id) do update set name=excluded.name,code=excluded.code,address=excluded.address,email=excluded.email,phone=excluded.phone,status=excluded.status,default_inventory_location_id=excluded.default_inventory_location_id
  where branches.organization_id=p_organization_id;
  if not found then raise exception 'not_found'; end if;
  perform public.accounting_audit(p_organization_id,case when p_branch_id is null then 'branch.created' else 'branch.updated' end,'branch',v_id,jsonb_build_object('status',p_status));
  return v_id;
end $$;

create or replace function public.get_organization_members(p_organization_id uuid) returns table(
  membership_id uuid,user_id uuid,display_name text,email text,role public.membership_role,membership_status public.membership_status,is_owner boolean,default_branch_id uuid
) language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
begin
  perform public.assert_org_capability(p_organization_id,'users.manage');
  return query select m.id,m.user_id,coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),u.email::text,case when m.is_owner then 'owner'::public.membership_role else m.role end,m.membership_status,m.is_owner,m.default_branch_id
  from public.organization_memberships m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id where m.organization_id=p_organization_id order by m.is_owner desc,coalesce(p.display_name,u.email);
end $$;

create or replace function public.update_organization_member(p_organization_id uuid,p_membership_id uuid,p_role public.membership_role,p_status public.membership_status) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.organization_memberships%rowtype;
begin
  perform public.assert_org_capability(p_organization_id,'users.manage');
  select * into m from public.organization_memberships where id=p_membership_id and organization_id=p_organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if m.is_owner and (p_role<>'owner' or p_status<>'active') then raise exception 'owner_lockout_protected'; end if;
  if m.user_id=(select auth.uid()) and p_status='inactive' then raise exception 'self_lockout_protected'; end if;
  update public.organization_memberships set role=p_role,membership_status=p_status where id=m.id;
  perform public.accounting_audit(p_organization_id,'membership.updated','organization_membership',m.id,jsonb_build_object('user_id',m.user_id,'role',p_role,'status',p_status));
end $$;

create or replace function public.get_audit_log(
  p_organization_id uuid,p_from timestamptz default null,p_to timestamptz default null,p_user_id uuid default null,
  p_action text default null,p_branch_id uuid default null,p_entity_type text default null,p_limit integer default 200
) returns table(id uuid,created_at timestamptz,actor_user_id uuid,actor_name text,actor_email text,event_type text,entity_type text,entity_id uuid,branch_id uuid,branch_name text,description text,metadata jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public,auth as $$
begin
  perform public.assert_org_capability(p_organization_id,'audit.view');
  return query select e.id,e.created_at,e.actor_user_id,coalesce(nullif(p.display_name,''),split_part(u.email,'@',1),'System'),u.email::text,e.event_type,e.entity_type,e.entity_id,e.branch_id,b.name,
    initcap(replace(replace(e.event_type,'.',' '),'_',' '))||case when e.entity_id is null then '' else ' · '||e.entity_id::text end,e.metadata
  from public.audit_events e left join auth.users u on u.id=e.actor_user_id left join public.profiles p on p.id=e.actor_user_id left join public.branches b on b.id=e.branch_id and b.organization_id=e.organization_id
  where e.organization_id=p_organization_id and (p_from is null or e.created_at>=p_from) and (p_to is null or e.created_at<p_to)
    and (p_user_id is null or e.actor_user_id=p_user_id) and (p_action is null or e.event_type=p_action)
    and (p_branch_id is null or e.branch_id=p_branch_id) and (p_entity_type is null or e.entity_type=p_entity_type)
  order by e.created_at desc,e.id desc limit least(greatest(coalesce(p_limit,200),1),500);
end $$;

create or replace function public.save_party(
  p_organization_id uuid,p_kind text,p_id uuid,p_name text,p_trn text,p_email text,p_phone text,p_address text,p_payment_terms_days integer,p_is_active boolean
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  perform public.assert_org_capability(p_organization_id,'masters.manage');
  if p_kind not in ('customer','supplier') or coalesce(trim(p_name),'')='' or p_payment_terms_days<0 then raise exception 'invalid_input'; end if;
  if p_id is not null and ((p_kind='customer' and exists(select 1 from public.customers where id=p_id and organization_id<>p_organization_id)) or (p_kind='supplier' and exists(select 1 from public.suppliers where id=p_id and organization_id<>p_organization_id))) then raise exception 'not_authorized'; end if;
  if p_kind='customer' then
    insert into public.customers(id,organization_id,name,trn,email,phone,billing_address,payment_terms_days,is_active,created_by) values(v_id,p_organization_id,trim(p_name),nullif(trim(p_trn),''),nullif(trim(p_email),''),nullif(trim(p_phone),''),nullif(trim(p_address),''),p_payment_terms_days,p_is_active,(select auth.uid()))
    on conflict(id) do update set name=excluded.name,trn=excluded.trn,email=excluded.email,phone=excluded.phone,billing_address=excluded.billing_address,payment_terms_days=excluded.payment_terms_days,is_active=excluded.is_active where customers.organization_id=p_organization_id;
  else
    insert into public.suppliers(id,organization_id,name,trn,email,phone,billing_address,payment_terms_days,is_active,created_by) values(v_id,p_organization_id,trim(p_name),nullif(trim(p_trn),''),nullif(trim(p_email),''),nullif(trim(p_phone),''),nullif(trim(p_address),''),p_payment_terms_days,p_is_active,(select auth.uid()))
    on conflict(id) do update set name=excluded.name,trn=excluded.trn,email=excluded.email,phone=excluded.phone,billing_address=excluded.billing_address,payment_terms_days=excluded.payment_terms_days,is_active=excluded.is_active where suppliers.organization_id=p_organization_id;
  end if;
  perform public.accounting_audit(p_organization_id,p_kind||case when p_id is null then '.created' else '.updated' end,p_kind,v_id,jsonb_build_object('active',p_is_active));
  return v_id;
end $$;

-- Never let a sequence be rewound below the already-reserved next number.
create or replace function public.update_document_sequence(p_organization_id uuid,p_sequence_id uuid,p_prefix text,p_next_number bigint,p_padding smallint,p_suffix text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_current bigint;
begin
  perform public.assert_org_capability(p_organization_id,'accounting.setup.manage');
  select next_number into v_current from public.document_sequences where id=p_sequence_id and organization_id=p_organization_id for update;
  if v_current is null then raise exception 'not_found'; end if;
  if p_next_number<v_current or p_next_number<1 or p_padding not between 1 and 12 then raise exception 'sequence_rewind_not_allowed'; end if;
  update public.document_sequences set prefix=trim(p_prefix),next_number=p_next_number,padding=p_padding,suffix=nullif(trim(p_suffix),'') where id=p_sequence_id;
  perform public.accounting_audit(p_organization_id,'document_sequence.updated','document_sequence',p_sequence_id,jsonb_build_object('previous_next_number',v_current,'next_number',p_next_number));
end $$;

drop policy if exists audit_member_select on public.audit_events;
create policy audit_capability_select on public.audit_events for select to authenticated using(public.has_org_capability(organization_id,'audit.view'));
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
create policy products_manage_insert on public.products for insert to authenticated with check(created_by=(select auth.uid()) and public.has_org_capability(organization_id,'masters.manage'));
create policy products_manage_update on public.products for update to authenticated using(public.has_org_capability(organization_id,'masters.manage')) with check(public.has_org_capability(organization_id,'masters.manage'));
drop policy if exists inventory_units_insert on public.inventory_units;
drop policy if exists inventory_units_update on public.inventory_units;
create policy inventory_units_manage_insert on public.inventory_units for insert to authenticated with check(created_by=(select auth.uid()) and public.has_org_capability(organization_id,'inventory.manage'));
create policy inventory_units_manage_update on public.inventory_units for update to authenticated using(public.has_org_capability(organization_id,'inventory.manage')) with check(public.has_org_capability(organization_id,'inventory.manage'));
drop policy if exists inventory_locations_insert on public.inventory_locations;
drop policy if exists inventory_locations_update on public.inventory_locations;
create policy inventory_locations_manage_insert on public.inventory_locations for insert to authenticated with check(created_by=(select auth.uid()) and public.has_org_capability(organization_id,'inventory.manage'));
create policy inventory_locations_manage_update on public.inventory_locations for update to authenticated using(public.has_org_capability(organization_id,'inventory.manage')) with check(public.has_org_capability(organization_id,'inventory.manage'));

create or replace function public.audit_master_change() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.accounting_audit(new.organization_id,tg_argv[0]||case when tg_op='INSERT' then '.created' else '.updated' end,tg_argv[0],new.id,jsonb_build_object('status',new.status));
  return new;
end $$;
create trigger products_audit after insert or update on public.products for each row execute function public.audit_master_change('product');
create trigger inventory_locations_audit after insert or update on public.inventory_locations for each row execute function public.audit_master_change('inventory_location');
create trigger inventory_units_audit after insert or update on public.inventory_units for each row execute function public.audit_master_change('inventory_unit');

revoke all on function public.update_company_profile(uuid,text,text,text,text,text,text,text,text,text,text),public.save_organization_branch(uuid,uuid,text,text,text,text,text,public.entity_status,uuid),public.get_organization_members(uuid),public.update_organization_member(uuid,uuid,public.membership_role,public.membership_status),public.get_audit_log(uuid,timestamptz,timestamptz,uuid,text,uuid,text,integer),public.save_party(uuid,text,uuid,text,text,text,text,text,integer,boolean) from public,anon;
grant execute on function public.update_company_profile(uuid,text,text,text,text,text,text,text,text,text,text),public.save_organization_branch(uuid,uuid,text,text,text,text,text,public.entity_status,uuid),public.get_organization_members(uuid),public.update_organization_member(uuid,uuid,public.membership_role,public.membership_status),public.get_audit_log(uuid,timestamptz,timestamptz,uuid,text,uuid,text,integer),public.save_party(uuid,text,uuid,text,text,text,text,text,integer,boolean) to authenticated;
