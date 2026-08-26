create or replace function public.update_journal_draft(
  p_organization_id uuid,
  p_journal_id uuid,
  p_journal_date date,
  p_reference text,
  p_description text,
  p_lines jsonb,
  p_branch_id uuid default null
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_line jsonb;
  v_line_number int := 0;
begin
  perform public.assert_journal_draft(p_organization_id, p_journal_id);
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and organization_id = p_organization_id
  ) then
    raise exception 'invalid_branch';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as submitted_line
    join public.accounts account_row on account_row.id = (submitted_line ->> 'account_id')::uuid
    where account_row.organization_id <> p_organization_id
       or not account_row.is_active
       or not account_row.allow_manual_posting
  ) then
    raise exception 'invalid_posting_account';
  end if;
  update public.journal_entries
  set journal_date = p_journal_date,
      branch_id = p_branch_id,
      reference = nullif(trim(p_reference), ''),
      description = trim(p_description)
  where id = p_journal_id;
  delete from public.journal_lines where journal_entry_id = p_journal_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := v_line_number + 1;
    insert into public.journal_lines (
      organization_id, journal_entry_id, line_number, account_id, description, debit_amount, credit_amount
    ) values (
      p_organization_id, p_journal_id, v_line_number, (v_line ->> 'account_id')::uuid,
      nullif(v_line ->> 'description', ''),
      coalesce((v_line ->> 'debit')::numeric, 0),
      coalesce((v_line ->> 'credit')::numeric, 0)
    );
  end loop;
  perform public.accounting_audit(p_organization_id, 'journal.updated', 'journal_entry', p_journal_id);
end;
$$;

revoke all on function public.update_journal_draft(uuid,uuid,date,text,text,jsonb,uuid) from public,anon;
grant execute on function public.update_journal_draft(uuid,uuid,date,text,text,jsonb,uuid) to authenticated;
