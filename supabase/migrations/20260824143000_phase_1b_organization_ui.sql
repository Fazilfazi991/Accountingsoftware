create or replace function public.update_organization_settings(p_organization_id uuid, p_name text, p_legal_name text, p_currency text, p_timezone text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_organization_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_timezone), '') = '' or p_currency <> 'AED' then raise exception 'invalid_input'; end if;
  update public.organizations set name = trim(p_name), legal_name = nullif(trim(p_legal_name), ''), base_currency = p_currency, timezone = trim(p_timezone) where id = p_organization_id;
end; $$;

create or replace function public.create_organization_branch(p_organization_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_organization_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'invalid_input'; end if;
  insert into public.branches(id, organization_id, name) values(v_id, p_organization_id, trim(p_name));
  return v_id;
end; $$;

create or replace function public.update_organization_branch(p_organization_id uuid, p_branch_id uuid, p_name text, p_status public.entity_status)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_organization_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'invalid_input'; end if;
  if p_status = 'inactive' and (select count(*) from public.branches where organization_id = p_organization_id and status = 'active') <= 1 and exists(select 1 from public.branches where id = p_branch_id and organization_id = p_organization_id and status = 'active') then raise exception 'last_active_branch'; end if;
  update public.branches set name = trim(p_name), status = p_status where id = p_branch_id and organization_id = p_organization_id;
  if not found then raise exception 'not_found'; end if;
end; $$;

revoke all on function public.update_organization_settings(uuid,text,text,text,text), public.create_organization_branch(uuid,text), public.update_organization_branch(uuid,uuid,text,public.entity_status) from public;
grant execute on function public.update_organization_settings(uuid,text,text,text,text), public.create_organization_branch(uuid,text), public.update_organization_branch(uuid,uuid,text,public.entity_status) to authenticated;
