-- Repair first-organization onboarding after membership roles became mandatory.
-- The per-user advisory lock and existing-membership return make retries safe.

create or replace function public.create_organization(
  p_name text,
  p_legal_name text,
  p_slug text,
  p_branch_name text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_organization_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_membership_id uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if coalesce(trim(p_name), '') = ''
    or coalesce(trim(p_branch_name), '') = ''
    or coalesce(trim(p_slug), '') = '' then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ledgerly-onboarding:' || v_user::text, 0)
  );

  select m.organization_id
    into v_organization_id
  from public.organization_memberships m
  where m.user_id = v_user
    and m.membership_status = 'active'
  order by m.created_at, m.id
  limit 1;

  if found then
    return v_organization_id;
  end if;

  if exists (
    select 1 from public.organizations o where o.slug = p_slug
  ) then
    raise exception 'slug_taken';
  end if;

  v_organization_id := gen_random_uuid();

  insert into public.profiles(id, display_name)
  select
    u.id,
    coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), '')
  from auth.users u
  where u.id = v_user
  on conflict (id) do nothing;

  insert into public.organizations(
    id, name, legal_name, slug, created_by
  ) values (
    v_organization_id,
    trim(p_name),
    nullif(trim(p_legal_name), ''),
    p_slug,
    v_user
  );

  insert into public.branches(id, organization_id, name)
  values (v_branch_id, v_organization_id, trim(p_branch_name));

  insert into public.organization_memberships(
    id,
    organization_id,
    user_id,
    membership_status,
    is_owner,
    role,
    default_branch_id
  ) values (
    v_membership_id,
    v_organization_id,
    v_user,
    'active',
    true,
    'owner',
    v_branch_id
  );

  insert into public.organization_settings(organization_id)
  values (v_organization_id);

  insert into public.audit_events(
    organization_id,
    branch_id,
    actor_user_id,
    actor_membership_id,
    event_type,
    entity_type,
    entity_id
  ) values
    (
      v_organization_id,
      v_branch_id,
      v_user,
      v_membership_id,
      'organization.created',
      'organization',
      v_organization_id
    ),
    (
      v_organization_id,
      v_branch_id,
      v_user,
      v_membership_id,
      'branch.created',
      'branch',
      v_branch_id
    );

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text)
  from public, anon;
grant execute on function public.create_organization(text, text, text, text)
  to authenticated;
