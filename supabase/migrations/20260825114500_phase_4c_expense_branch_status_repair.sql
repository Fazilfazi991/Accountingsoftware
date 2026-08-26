-- Forward repair: Ledgerly branches use entity_status in `status`, not `is_active`.
create or replace function public.assert_expense_inputs(p_organization_id uuid, p_expense_date date, p_expense_account_id uuid, p_tax_rate_id uuid, p_payment_account_id uuid, p_branch_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_expense_date is null then raise exception 'invalid_expense_date'; end if;
  if p_branch_id is not null and not exists (select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception 'invalid_branch'; end if;
  if not exists (select 1 from public.accounts a join public.account_groups g on g.id=a.account_group_id where a.id=p_expense_account_id and a.organization_id=p_organization_id and a.is_active and g.classification='expense' and g.is_active) then raise exception 'invalid_expense_account'; end if;
  if not exists (select 1 from public.accounts a where a.id=p_payment_account_id and a.organization_id=p_organization_id and a.is_active and a.account_type in ('cash','bank') and (exists (select 1 from public.cash_accounts c where c.organization_id=p_organization_id and c.account_id=a.id and c.is_active) or exists (select 1 from public.bank_accounts b where b.organization_id=p_organization_id and b.account_id=a.id and b.is_active))) then raise exception 'invalid_cash_or_bank_account'; end if;
  if p_tax_rate_id is not null and not exists (select 1 from public.tax_rates where id=p_tax_rate_id and organization_id=p_organization_id and is_active and purchase_enabled and (effective_from is null or effective_from<=p_expense_date) and (effective_to is null or effective_to>=p_expense_date)) then raise exception 'invalid_vat_rate'; end if;
end; $$;
revoke all on function public.assert_expense_inputs(uuid,date,uuid,uuid,uuid,uuid) from public,anon,authenticated;
