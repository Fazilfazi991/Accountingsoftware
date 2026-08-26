-- Batch 10.2: authoritative financial statements from posted journal lines.

create type public.cash_flow_category as enum ('cash', 'operating', 'investing', 'financing');

alter table public.accounts
  add column cash_flow_category public.cash_flow_category;

update public.accounts
set cash_flow_category = case
  when account_type in ('cash', 'bank') then 'cash'::public.cash_flow_category
  when system_key in ('owner_capital', 'retained_earnings', 'drawings') then 'financing'::public.cash_flow_category
  when system_key in (
    'accounts_receivable', 'inventory', 'input_vat', 'other_current_assets',
    'accounts_payable', 'output_vat', 'other_current_liabilities',
    'sales_revenue', 'service_revenue', 'other_income', 'cost_of_goods_sold',
    'rent_expense', 'salary_expense', 'utilities', 'office_expense',
    'marketing_expense', 'bank_charges', 'professional_fees', 'other_expense',
    'inventory_adjustment'
  ) then 'operating'::public.cash_flow_category
  else null
end;

create function public.enforce_account_cash_flow_category() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.account_type in ('cash','bank') then
    new.cash_flow_category := 'cash';
  elsif new.cash_flow_category = 'cash' then
    raise exception 'cash_category_requires_cash_account';
  end if;
  return new;
end;
$$;
create trigger enforce_account_cash_flow_category_trigger
before insert or update of account_type,cash_flow_category on public.accounts
for each row execute function public.enforce_account_cash_flow_category();

create or replace function public.set_account_cash_flow_category(
  p_organization_id uuid,
  p_account_id uuid,
  p_category public.cash_flow_category
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.accounts%rowtype;
begin
  perform public.assert_accounting_owner(p_organization_id);
  select * into v_account
  from public.accounts
  where id = p_account_id and organization_id = p_organization_id;
  if not found then raise exception 'account_not_found'; end if;
  if v_account.account_type in ('cash', 'bank') and p_category <> 'cash' then
    raise exception 'cash_account_category_protected';
  end if;
  if v_account.account_type not in ('cash', 'bank') and p_category = 'cash' then
    raise exception 'cash_category_requires_cash_account';
  end if;
  update public.accounts
  set cash_flow_category = p_category, updated_at = now()
  where id = p_account_id and organization_id = p_organization_id;
  perform public.accounting_audit(
    p_organization_id, 'account.cash_flow_category_updated', 'account', p_account_id,
    jsonb_build_object('category', p_category)
  );
end;
$$;

create or replace function public.get_general_ledger(
  p_organization_id uuid,p_account_id uuid,p_from date,p_to date
) returns table(journal_date date,journal_number text,reference text,description text,debit numeric,credit numeric,running_balance numeric)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then
    raise exception 'Active organization membership required';
  end if;
  if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid ledger period'; end if;
  if not exists(select 1 from public.accounts where id=p_account_id and organization_id=p_organization_id) then
    raise exception 'Account not found';
  end if;
  return query
  select j.journal_date,j.journal_number,j.reference,coalesce(l.description,j.description),l.debit_amount,l.credit_amount,
    sum(l.debit_amount-l.credit_amount) over(order by j.journal_date,j.created_at,l.line_number,l.id)
  from public.journal_lines l join public.journal_entries j on j.id=l.journal_entry_id
  where j.organization_id=p_organization_id and l.organization_id=p_organization_id
    and l.account_id=p_account_id and j.status in ('posted','reversed') and j.journal_date between p_from and p_to
  order by j.journal_date,j.created_at,l.line_number,l.id;
end;
$$;

create or replace function public.get_profit_and_loss(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then
    raise exception 'Active organization membership required';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36600 then
    raise exception 'Invalid reporting period';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches
    where id = p_branch_id and organization_id = p_organization_id and status = 'active'
  ) then raise exception 'Invalid branch'; end if;

  with account_totals as (
    select
      a.id account_id, a.code account_code, a.name account_name,
      g.id group_id, g.code group_code, g.name group_name, g.system_key group_key,
      g.classification::text classification, g.sort_order,
      case
        when g.classification = 'income' then coalesce(sum(l.credit_amount - l.debit_amount) filter(where j.id is not null), 0)
        else coalesce(sum(l.debit_amount - l.credit_amount) filter(where j.id is not null), 0)
      end amount
    from public.accounts a
    join public.account_groups g on g.id = a.account_group_id and g.organization_id = p_organization_id
    left join public.journal_lines l on l.account_id = a.id and l.organization_id = p_organization_id
    left join public.journal_entries j on j.id = l.journal_entry_id
      and j.organization_id = p_organization_id
      and j.status in ('posted', 'reversed')
      and j.journal_date between p_from and p_to
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
    where a.organization_id = p_organization_id
      and g.classification in ('income', 'expense')
    group by a.id,a.code,a.name,g.id,g.code,g.name,g.system_key,g.classification,g.sort_order
  ), nonzero as (
    select * from account_totals where amount <> 0
  ), grouped as (
    select
      group_id,group_code,group_name,group_key,classification,sort_order,
      sum(amount) total,
      jsonb_agg(jsonb_build_object(
        'accountId', account_id, 'accountCode', account_code,
        'accountName', account_name, 'amount', amount
      ) order by account_code, account_id) accounts
    from nonzero
    group by group_id,group_code,group_name,group_key,classification,sort_order
  ), totals as (
    select
      coalesce(sum(total) filter (where classification = 'income'), 0) revenue,
      coalesce(sum(total) filter (where classification = 'expense' and group_key = 'cost_of_sales'), 0) cogs,
      coalesce(sum(total) filter (where classification = 'expense' and group_key is distinct from 'cost_of_sales'), 0) expenses
    from grouped
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'branchId', p_branch_id,
    'revenueGroups', coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='income'), '[]'::jsonb),
    'cogsGroups', coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='expense' and group_key='cost_of_sales'), '[]'::jsonb),
    'expenseGroups', coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='expense' and group_key is distinct from 'cost_of_sales'), '[]'::jsonb),
    'revenue', t.revenue,
    'cogs', t.cogs,
    'grossProfit', t.revenue - t.cogs,
    'expenses', t.expenses,
    'netProfit', t.revenue - t.cogs - t.expenses
  ) into v_result
  from totals t;
  return v_result;
end;
$$;

create or replace function public.get_balance_sheet(
  p_organization_id uuid,
  p_as_of date,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then
    raise exception 'Active organization membership required';
  end if;
  if p_as_of is null then raise exception 'Invalid as-of date'; end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches
    where id=p_branch_id and organization_id=p_organization_id and status='active'
  ) then raise exception 'Invalid branch'; end if;

  with account_totals as (
    select
      a.id account_id,a.code account_code,a.name account_name,a.system_key,a.account_type,
      g.id group_id,g.code group_code,g.name group_name,g.classification::text classification,g.sort_order,
      case when g.classification='asset'
        then coalesce(sum(l.debit_amount-l.credit_amount) filter(where j.id is not null),0)
        else coalesce(sum(l.credit_amount-l.debit_amount) filter(where j.id is not null),0)
      end amount
    from public.accounts a
    join public.account_groups g on g.id=a.account_group_id and g.organization_id=p_organization_id
    left join public.journal_lines l on l.account_id=a.id and l.organization_id=p_organization_id
    left join public.journal_entries j on j.id=l.journal_entry_id
      and j.organization_id=p_organization_id and j.status in ('posted','reversed')
      and j.journal_date<=p_as_of
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
    where a.organization_id=p_organization_id and g.classification in ('asset','liability','equity')
    group by a.id,a.code,a.name,a.system_key,a.account_type,g.id,g.code,g.name,g.classification,g.sort_order
  ), nonzero as (
    select * from account_totals where amount<>0
  ), grouped as (
    select group_id,group_code,group_name,classification,sort_order,sum(amount) total,
      jsonb_agg(jsonb_build_object(
        'accountId',account_id,'accountCode',account_code,'accountName',account_name,
        'systemKey',system_key,'accountType',account_type,'amount',amount
      ) order by account_code,account_id) accounts
    from nonzero
    group by group_id,group_code,group_name,classification,sort_order
  ), earnings as (
    select coalesce(sum(case when g.classification='income'
      then l.credit_amount-l.debit_amount else l.credit_amount-l.debit_amount end),0) current_earnings
    from public.journal_entries j
    join public.journal_lines l on l.journal_entry_id=j.id and l.organization_id=p_organization_id
    join public.accounts a on a.id=l.account_id and a.organization_id=p_organization_id
    join public.account_groups g on g.id=a.account_group_id and g.organization_id=p_organization_id
    where j.organization_id=p_organization_id and j.status in ('posted','reversed')
      and j.journal_date<=p_as_of and g.classification in ('income','expense')
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
  ), totals as (
    select
      coalesce(sum(total) filter(where classification='asset'),0) assets,
      coalesce(sum(total) filter(where classification='liability'),0) liabilities,
      coalesce(sum(total) filter(where classification='equity'),0) equity_accounts
    from grouped
  ), operational as (
    select
      coalesce(sum(oi.original_amount - coalesce((
        select sum(oa.amount) from public.open_item_allocations oa
        left join public.customer_receipts cr on cr.id=oa.customer_receipt_id
        left join public.supplier_payments sp on sp.id=oa.supplier_payment_id
        left join public.sales_credit_notes sc on sc.id=oa.sales_credit_note_id
        left join public.purchase_debit_notes pd on pd.id=oa.purchase_debit_note_id
        where oa.open_item_id=oi.id and oa.organization_id=p_organization_id
          and coalesce(cr.receipt_date,sp.payment_date,sc.credit_note_date,pd.debit_note_date)<=p_as_of
      ),0)) filter(where oi.kind='receivable'),0) ar,
      coalesce(sum(oi.original_amount - coalesce((
        select sum(oa.amount) from public.open_item_allocations oa
        left join public.customer_receipts cr on cr.id=oa.customer_receipt_id
        left join public.supplier_payments sp on sp.id=oa.supplier_payment_id
        left join public.sales_credit_notes sc on sc.id=oa.sales_credit_note_id
        left join public.purchase_debit_notes pd on pd.id=oa.purchase_debit_note_id
        where oa.open_item_id=oi.id and oa.organization_id=p_organization_id
          and coalesce(cr.receipt_date,sp.payment_date,sc.credit_note_date,pd.debit_note_date)<=p_as_of
      ),0)) filter(where oi.kind='payable'),0) ap
    from public.open_items oi
    join public.journal_entries source_journal on source_journal.id=oi.source_journal_id
      and source_journal.organization_id=p_organization_id
    where oi.organization_id=p_organization_id and source_journal.journal_date<=p_as_of
      and (p_branch_id is null or source_journal.branch_id is not distinct from p_branch_id)
  ), inventory as (
    select case when p_branch_id is not null then null::numeric else coalesce(sum(latest.resulting_value),0) end valuation
    from public.products p
    left join lateral (
      select e.resulting_value from public.inventory_cost_events e
      where e.organization_id=p_organization_id and e.product_id=p.id and e.event_date<=p_as_of
      order by e.sequence desc limit 1
    ) latest on true
    where p.organization_id=p_organization_id and p.kind='product' and p.track_inventory
  ), ledger_controls as (
    select
      coalesce(sum(amount) filter(where system_key='accounts_receivable'),0) ar,
      coalesce(sum(amount) filter(where system_key='accounts_payable'),0) ap,
      coalesce(sum(amount) filter(where system_key='inventory'),0) inventory,
      coalesce(sum(amount) filter(where account_type in ('cash','bank')),0) cash_bank,
      coalesce(sum(amount) filter(where account_type='cash'),0) cash,
      coalesce(sum(amount) filter(where account_type='bank'),0) bank
    from account_totals
  )
  select jsonb_build_object(
    'asOf',p_as_of,'branchId',p_branch_id,
    'assetGroups',coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='asset'),'[]'::jsonb),
    'liabilityGroups',coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='liability'),'[]'::jsonb),
    'equityGroups',coalesce((select jsonb_agg(jsonb_build_object(
      'groupId',group_id,'groupCode',group_code,'groupName',group_name,'total',total,'accounts',accounts
    ) order by sort_order,group_code,group_id) from grouped where classification='equity'),'[]'::jsonb),
    'assets',t.assets,'liabilities',t.liabilities,'equityAccounts',t.equity_accounts,
    'currentEarnings',e.current_earnings,
    'equity',t.equity_accounts+e.current_earnings,
    'liabilitiesAndEquity',t.liabilities+t.equity_accounts+e.current_earnings,
    'difference',t.assets-(t.liabilities+t.equity_accounts+e.current_earnings),
    'reconciliations',jsonb_build_object(
      'ar',jsonb_build_object('ledger',lc.ar,'operational',o.ar,'difference',lc.ar-o.ar),
      'ap',jsonb_build_object('ledger',lc.ap,'operational',o.ap,'difference',lc.ap-o.ap),
      'inventory',jsonb_build_object('ledger',lc.inventory,'operational',i.valuation,
        'difference',case when i.valuation is null then null else lc.inventory-i.valuation end,
        'note',case when p_branch_id is null then null else 'Branch inventory valuation is not attributable in the current cost-event schema.' end),
      'cashBank',jsonb_build_object('ledger',lc.cash_bank,'cash',lc.cash,'bank',lc.bank,'difference',0)
    )
  ) into v_result
  from totals t cross join earnings e cross join operational o cross join inventory i cross join ledger_controls lc;
  return v_result;
end;
$$;

create or replace function public.get_cash_flow_statement(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_org_member(p_organization_id) then
    raise exception 'Active organization membership required';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to-p_from>36600 then
    raise exception 'Invalid reporting period';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches
    where id=p_branch_id and organization_id=p_organization_id and status='active'
  ) then raise exception 'Invalid branch'; end if;

  with cash_accounts as (
    select id from public.accounts
    where organization_id=p_organization_id and cash_flow_category='cash'
  ), cash_journals as (
    select distinct j.id
    from public.journal_entries j
    join public.journal_lines l on l.journal_entry_id=j.id and l.organization_id=p_organization_id
    join cash_accounts ca on ca.id=l.account_id
    where j.organization_id=p_organization_id and j.status in ('posted','reversed')
      and j.journal_date between p_from and p_to
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
  ), movements as (
    select a.id account_id,a.code account_code,a.name account_name,
      a.cash_flow_category::text category,
      sum(l.credit_amount-l.debit_amount) amount
    from cash_journals cj
    join public.journal_lines l on l.journal_entry_id=cj.id and l.organization_id=p_organization_id
    join public.accounts a on a.id=l.account_id and a.organization_id=p_organization_id
    where a.cash_flow_category is distinct from 'cash'::public.cash_flow_category
    group by a.id,a.code,a.name,a.cash_flow_category
    having sum(l.credit_amount-l.debit_amount)<>0
  ), section_totals as (
    select
      coalesce(sum(amount) filter(where category='operating'),0) operating,
      coalesce(sum(amount) filter(where category='investing'),0) investing,
      coalesce(sum(amount) filter(where category='financing'),0) financing,
      coalesce(sum(amount) filter(where category is null),0) unclassified
    from movements
  ), cash_totals as (
    select
      coalesce(sum(l.debit_amount-l.credit_amount) filter(where j.journal_date<p_from),0) opening,
      coalesce(sum(l.debit_amount-l.credit_amount) filter(where j.journal_date<=p_to),0) closing
    from public.journal_entries j
    join public.journal_lines l on l.journal_entry_id=j.id and l.organization_id=p_organization_id
    join cash_accounts ca on ca.id=l.account_id
    where j.organization_id=p_organization_id and j.status in ('posted','reversed')
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
  )
  select jsonb_build_object(
    'method','direct','from',p_from,'to',p_to,'branchId',p_branch_id,
    'operating',s.operating,'investing',s.investing,'financing',s.financing,
    'unclassified',s.unclassified,
    'netCashMovement',c.closing-c.opening,'openingCash',c.opening,'closingCash',c.closing,
    'reconciliationDifference',(c.closing-c.opening)-(s.operating+s.investing+s.financing+s.unclassified),
    'operatingRows',coalesce((select jsonb_agg(jsonb_build_object(
      'accountId',account_id,'accountCode',account_code,'accountName',account_name,'amount',amount
    ) order by account_code,account_id) from movements where category='operating'),'[]'::jsonb),
    'investingRows',coalesce((select jsonb_agg(jsonb_build_object(
      'accountId',account_id,'accountCode',account_code,'accountName',account_name,'amount',amount
    ) order by account_code,account_id) from movements where category='investing'),'[]'::jsonb),
    'financingRows',coalesce((select jsonb_agg(jsonb_build_object(
      'accountId',account_id,'accountCode',account_code,'accountName',account_name,'amount',amount
    ) order by account_code,account_id) from movements where category='financing'),'[]'::jsonb),
    'unclassifiedRows',coalesce((select jsonb_agg(jsonb_build_object(
      'accountId',account_id,'accountCode',account_code,'accountName',account_name,'amount',amount
    ) order by account_code,account_id) from movements where category is null),'[]'::jsonb)
  ) into v_result
  from section_totals s cross join cash_totals c;
  return v_result;
end;
$$;

create index journal_entries_financial_reports_idx
  on public.journal_entries (organization_id, journal_date, branch_id, id)
  where status in ('posted', 'reversed');

revoke all on function public.set_account_cash_flow_category(uuid,uuid,public.cash_flow_category),
  public.get_general_ledger(uuid,uuid,date,date),
  public.get_profit_and_loss(uuid,date,date,uuid),
  public.get_balance_sheet(uuid,date,uuid),
  public.get_cash_flow_statement(uuid,date,date,uuid)
from public, anon;
grant execute on function public.set_account_cash_flow_category(uuid,uuid,public.cash_flow_category),
  public.get_general_ledger(uuid,uuid,date,date),
  public.get_profit_and_loss(uuid,date,date,uuid),
  public.get_balance_sheet(uuid,date,uuid),
  public.get_cash_flow_statement(uuid,date,date,uuid)
to authenticated;
