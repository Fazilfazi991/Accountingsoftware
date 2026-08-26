-- Development-only QA fixture helper. It is deliberately not executable by
-- anon or authenticated roles and is callable only from a trusted DB context.
create or replace function public.qa_toggle_user_a_membership(p_status public.membership_status)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_id uuid;
  v_event text;
begin
  if p_status not in ('active', 'inactive') then raise exception 'invalid_qa_status'; end if;
  select m.id into v_membership_id
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join auth.users u on u.id = m.user_id
  where u.email = 'ledgerly-qa-user-a@ledgerly.test'
    and o.slug = 'ledgerly-qa-company-a';
  if v_membership_id is null then raise exception 'qa_fixture_not_found'; end if;
  update public.organization_memberships set membership_status = p_status where id = v_membership_id;
  v_event := case when p_status = 'inactive' then 'qa.membership.deactivated' else 'qa.membership.restored' end;
  insert into public.audit_events (organization_id, actor_membership_id, event_type, entity_type, entity_id, metadata)
  select m.organization_id, m.id, v_event, 'organization_membership', m.id, jsonb_build_object('qa_fixture', true)
  from public.organization_memberships m where m.id = v_membership_id;
end;
$$;
revoke all on function public.qa_toggle_user_a_membership(public.membership_status) from public;
