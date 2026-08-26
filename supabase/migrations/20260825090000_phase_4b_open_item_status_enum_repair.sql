-- Forward repair for Phase 4B settlement CASE expressions. PostgreSQL resolves
-- string-literal CASE branches as text before assignment to open_item_status.
-- This narrowly restores assignment coercion for the existing enum labels.
create or replace function public.text_to_open_item_status(p_value text)
returns public.open_item_status
language sql
immutable
strict
security invoker
set search_path=pg_catalog,public
as $$ select p_value::public.open_item_status $$;

drop cast if exists (text as public.open_item_status);
create cast (text as public.open_item_status)
with function public.text_to_open_item_status(text)
as assignment;

revoke all on function public.text_to_open_item_status(text) from public,anon,authenticated;
