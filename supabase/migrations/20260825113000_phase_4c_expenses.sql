-- Phase 4C.1: paid expenses. All accounting effects flow through the journal engine.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id),
  financial_year_id uuid references public.financial_years(id),
  expense_date date not null,
  expense_number text,
  payee_name text,
  expense_account_id uuid not null references public.accounts(id),
  tax_rate_id uuid references public.tax_rates(id),
  net_amount numeric(20,6) not null default 0 check (net_amount >= 0),
  tax_amount numeric(20,6) not null default 0 check (tax_amount >= 0),
  total_amount numeric(20,6) not null default 0 check (total_amount >= 0),
  payment_account_id uuid not null references public.accounts(id),
  reference text,
  notes text,
  status public.business_document_status not null default 'draft',
  posted_journal_id uuid references public.journal_entries(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, expense_number)
);
create index expenses_organization_date_idx on public.expenses(organization_id, expense_date desc);
alter table public.expenses enable row level security;
create policy expenses_member_select on public.expenses for select to authenticated using (public.is_active_org_member(organization_id));
create trigger expenses_updated before update on public.expenses for each row execute function public.set_updated_at();
revoke all on public.expenses from public, anon;
grant select on public.expenses to authenticated;

create or replace function public.assert_expense_inputs(p_organization_id uuid, p_expense_date date, p_expense_account_id uuid, p_tax_rate_id uuid, p_payment_account_id uuid, p_branch_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_expense_date is null then raise exception 'invalid_expense_date'; end if;
  if p_branch_id is not null and not exists (select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and is_active) then raise exception 'invalid_branch'; end if;
  if not exists (select 1 from public.accounts a join public.account_groups g on g.id=a.account_group_id where a.id=p_expense_account_id and a.organization_id=p_organization_id and a.is_active and g.classification='expense' and g.is_active) then raise exception 'invalid_expense_account'; end if;
  if not exists (select 1 from public.accounts a where a.id=p_payment_account_id and a.organization_id=p_organization_id and a.is_active and a.account_type in ('cash','bank') and (exists (select 1 from public.cash_accounts c where c.organization_id=p_organization_id and c.account_id=a.id and c.is_active) or exists (select 1 from public.bank_accounts b where b.organization_id=p_organization_id and b.account_id=a.id and b.is_active))) then raise exception 'invalid_cash_or_bank_account'; end if;
  if p_tax_rate_id is not null and not exists (select 1 from public.tax_rates where id=p_tax_rate_id and organization_id=p_organization_id and is_active and purchase_enabled and (effective_from is null or effective_from<=p_expense_date) and (effective_to is null or effective_to>=p_expense_date)) then raise exception 'invalid_vat_rate'; end if;
end; $$;

create or replace function public.create_expense_draft(p_organization_id uuid,p_expense_date date,p_expense_account_id uuid,p_payment_account_id uuid,p_net_amount numeric,p_tax_rate_id uuid default null,p_branch_id uuid default null,p_payee_name text default null,p_reference text default null,p_notes text default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=gen_random_uuid(); v_tax numeric(20,6):=0;
begin
  perform public.assert_accounting_owner(p_organization_id);
  perform public.assert_expense_inputs(p_organization_id,p_expense_date,p_expense_account_id,p_tax_rate_id,p_payment_account_id,p_branch_id);
  if p_net_amount is null or p_net_amount<=0 then raise exception 'invalid_expense_amount'; end if;
  if p_tax_rate_id is not null then select round(p_net_amount*rate_percent/100,6) into v_tax from public.tax_rates where id=p_tax_rate_id and organization_id=p_organization_id; end if;
  insert into public.expenses(id,organization_id,branch_id,expense_date,payee_name,expense_account_id,tax_rate_id,net_amount,tax_amount,total_amount,payment_account_id,reference,notes,created_by)
  values(v_id,p_organization_id,p_branch_id,p_expense_date,nullif(trim(p_payee_name),''),p_expense_account_id,p_tax_rate_id,round(p_net_amount,6),v_tax,round(p_net_amount,6)+v_tax,p_payment_account_id,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
  perform public.accounting_audit(p_organization_id,'expense.created','expense',v_id);
  return v_id;
end; $$;

create or replace function public.update_expense_draft(p_organization_id uuid,p_expense_id uuid,p_expense_date date,p_expense_account_id uuid,p_payment_account_id uuid,p_net_amount numeric,p_tax_rate_id uuid default null,p_branch_id uuid default null,p_payee_name text default null,p_reference text default null,p_notes text default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tax numeric(20,6):=0;
begin
  perform public.assert_accounting_owner(p_organization_id);
  perform public.assert_expense_inputs(p_organization_id,p_expense_date,p_expense_account_id,p_tax_rate_id,p_payment_account_id,p_branch_id);
  if p_net_amount is null or p_net_amount<=0 then raise exception 'invalid_expense_amount'; end if;
  if p_tax_rate_id is not null then select round(p_net_amount*rate_percent/100,6) into v_tax from public.tax_rates where id=p_tax_rate_id and organization_id=p_organization_id; end if;
  update public.expenses set branch_id=p_branch_id,expense_date=p_expense_date,payee_name=nullif(trim(p_payee_name),''),expense_account_id=p_expense_account_id,tax_rate_id=p_tax_rate_id,net_amount=round(p_net_amount,6),tax_amount=v_tax,total_amount=round(p_net_amount,6)+v_tax,payment_account_id=p_payment_account_id,reference=nullif(trim(p_reference),''),notes=nullif(trim(p_notes),'') where id=p_expense_id and organization_id=p_organization_id and status='draft';
  if not found then raise exception 'expense_not_editable'; end if;
  perform public.accounting_audit(p_organization_id,'expense.updated','expense',p_expense_id);
end; $$;

create or replace function public.delete_expense_draft(p_organization_id uuid,p_expense_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.assert_accounting_owner(p_organization_id);
  delete from public.expenses where id=p_expense_id and organization_id=p_organization_id and status='draft';
  if not found then raise exception 'expense_not_editable'; end if;
end; $$;

create or replace function public.post_expense(p_organization_id uuid,p_expense_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.expenses%rowtype; v_journal uuid:=gen_random_uuid(); v_tax public.tax_rates%rowtype; v_tax_amount numeric(20,6):=0; v_total numeric(20,6); v_input_vat uuid; v_fy uuid; v_number bigint; v_prefix text; v_padding smallint; v_suffix text;
begin
  perform public.assert_accounting_owner(p_organization_id);
  select * into d from public.expenses where id=p_expense_id and organization_id=p_organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if d.status='posted' then return jsonb_build_object('expense_id',d.id,'journal_id',d.posted_journal_id,'expense_number',d.expense_number,'already_posted',true); end if;
  if d.status<>'draft' then raise exception 'expense_not_postable'; end if;
  perform public.assert_expense_inputs(p_organization_id,d.expense_date,d.expense_account_id,d.tax_rate_id,d.payment_account_id,d.branch_id);
  select id into v_fy from public.financial_years where organization_id=p_organization_id and d.expense_date between start_date and end_date and status='open';
  if v_fy is null then raise exception 'financial_year_closed_or_missing'; end if;
  if d.tax_rate_id is not null then
    select * into v_tax from public.tax_rates where id=d.tax_rate_id and organization_id=p_organization_id and is_active and purchase_enabled;
    if not found then raise exception 'invalid_vat_rate'; end if;
    v_tax_amount:=round(d.net_amount*v_tax.rate_percent/100,6);
    if v_tax_amount<>0 then
      v_input_vat:=v_tax.input_account_id;
      if v_input_vat is null or not exists(select 1 from public.accounts where id=v_input_vat and organization_id=p_organization_id and is_active) then raise exception 'input_vat_account_missing'; end if;
    end if;
  end if;
  v_total:=d.net_amount+v_tax_amount;
  insert into public.journal_entries(id,organization_id,branch_id,financial_year_id,journal_date,source_type,source_id,description,created_by) values(v_journal,p_organization_id,d.branch_id,v_fy,d.expense_date,'expense',d.id,coalesce(nullif(d.payee_name,''),'Expense'),auth.uid());
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,tax_rate_id,tax_amount,branch_id) values(p_organization_id,v_journal,1,d.expense_account_id,coalesce(nullif(d.payee_name,''),'Expense'),d.net_amount,0,d.tax_rate_id,v_tax_amount,d.branch_id);
  if v_tax_amount<>0 then insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,tax_rate_id,tax_amount,branch_id) values(p_organization_id,v_journal,2,v_input_vat,'Input VAT',v_tax_amount,0,d.tax_rate_id,v_tax_amount,d.branch_id); end if;
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,branch_id) values(p_organization_id,v_journal,case when v_tax_amount<>0 then 3 else 2 end,d.payment_account_id,'Paid expense',0,v_total,d.branch_id);
  insert into public.document_sequences(organization_id,document_type,prefix) values(p_organization_id,'expense','EXP-') on conflict (organization_id,branch_id,document_type,financial_year_id) do nothing;
  select prefix,padding,suffix,next_number into v_prefix,v_padding,v_suffix,v_number from public.document_sequences where organization_id=p_organization_id and document_type='expense' and branch_id is null and financial_year_id is null for update;
  if v_number is null then raise exception 'expense_sequence_missing'; end if;
  update public.document_sequences set next_number=next_number+1 where organization_id=p_organization_id and document_type='expense' and branch_id is null and financial_year_id is null;
  update public.journal_entries set reference=v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,'') where id=v_journal;
  perform public.post_journal_entry(p_organization_id,v_journal);
  update public.expenses set financial_year_id=v_fy,expense_number=v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,''),tax_amount=v_tax_amount,total_amount=v_total,status='posted',posted_journal_id=v_journal,posted_at=now(),posted_by=auth.uid() where id=d.id;
  perform public.accounting_audit(p_organization_id,'expense.posted','expense',d.id,jsonb_build_object('journal_id',v_journal));
  return jsonb_build_object('expense_id',d.id,'journal_id',v_journal,'expense_number',v_prefix||lpad(v_number::text,v_padding,'0')||coalesce(v_suffix,''),'already_posted',false);
end; $$;

revoke all on function public.assert_expense_inputs(uuid,date,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_expense_draft(uuid,date,uuid,uuid,numeric,uuid,uuid,text,text,text),public.update_expense_draft(uuid,uuid,date,uuid,uuid,numeric,uuid,uuid,text,text,text),public.delete_expense_draft(uuid,uuid),public.post_expense(uuid,uuid) from public,anon;
grant execute on function public.create_expense_draft(uuid,date,uuid,uuid,numeric,uuid,uuid,text,text,text),public.update_expense_draft(uuid,uuid,date,uuid,uuid,numeric,uuid,uuid,text,text,text),public.delete_expense_draft(uuid,uuid),public.post_expense(uuid,uuid) to authenticated;
