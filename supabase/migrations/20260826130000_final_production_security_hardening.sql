-- Final forward-only production security repair.
-- Supabase-managed default privileges had reintroduced direct anon/PUBLIC
-- access after earlier per-function revokes. Keep the Data API surface closed
-- by default and remove the development-only membership helper entirely.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

drop function if exists public.qa_toggle_user_a_membership(public.membership_status);

-- Trigger functions are never client RPCs. Remove direct authenticated
-- execution while preserving their use by database triggers.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from authenticated', v_function);
  end loop;
end
$$;

