-- Keep organization edits controlled and write tenant change events without
-- opening audit_events to direct client writes.
create or replace function public.update_organization(
  p_organization_id uuid,
  p_name text,
  p_legal_name text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null or not public.is_org_owner(p_organization_id) then
    raise exception 'not_authorized';
  end if;

  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_timezone), '') = '' then
    raise exception 'invalid_input';
  end if;

  update public.organizations
  set name = trim(p_name),
      legal_name = nullif(trim(p_legal_name), ''),
      timezone = trim(p_timezone)
  where id = p_organization_id;
end;
$$;

create or replace function public.write_tenant_update_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_branch_id uuid;
  v_membership_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if tg_table_name = 'organizations' then
    v_organization_id := new.id;
    v_branch_id := null;
  else
    v_organization_id := new.organization_id;
    v_branch_id := new.id;
  end if;

  select id into v_membership_id
  from public.organization_memberships
  where organization_id = v_organization_id
    and user_id = (select auth.uid())
    and membership_status = 'active';

  if v_membership_id is null then
    raise exception 'not_authorized';
  end if;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    actor_membership_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_organization_id,
    v_branch_id,
    (select auth.uid()),
    v_membership_id,
    case when tg_table_name = 'organizations' then 'organization.updated' else 'branch.updated' end,
    case when tg_table_name = 'organizations' then 'organization' else 'branch' end,
    new.id,
    jsonb_build_object('source', 'app')
  );

  return new;
end;
$$;

create or replace function public.prevent_branch_tenant_key_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
    raise exception 'immutable_branch_identity';
  end if;
  return new;
end;
$$;

revoke all on function public.update_organization(uuid, text, text, text) from public;
grant execute on function public.update_organization(uuid, text, text, text) to authenticated;
revoke all on function public.write_tenant_update_audit_event() from public;
revoke all on function public.prevent_branch_tenant_key_update() from public;

create trigger organizations_audit_updated
after update on public.organizations
for each row execute function public.write_tenant_update_audit_event();

create trigger branches_identity_immutable
before update on public.branches
for each row execute function public.prevent_branch_tenant_key_update();

create trigger branches_audit_updated
after update on public.branches
for each row execute function public.write_tenant_update_audit_event();
