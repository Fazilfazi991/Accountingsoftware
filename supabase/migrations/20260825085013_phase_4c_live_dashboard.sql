-- Phase 4C.3: one tenant- and branch-scoped source for the live dashboard.
create or replace function public.get_live_dashboard(p_organization_id uuid,p_branch_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_cash_account_id uuid; v_cash numeric:=0; v_bank numeric:=0; v_receivables numeric:=0; v_payables numeric:=0;
  v_receivable_count integer:=0; v_payable_count integer:=0; v_bank_count integer:=0;
  v_banks jsonb:='[]'::jsonb; v_activity jsonb:='[]'::jsonb;
begin
  if not public.is_active_org_member(p_organization_id) then raise exception 'organization_access_denied'; end if;
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception 'invalid_branch'; end if;

  select id into v_cash_account_id from public.accounts where organization_id=p_organization_id and system_key='cash_on_hand' and is_active;
  select coalesce(sum(l.debit_amount-l.credit_amount),0) into v_cash from public.journal_lines l join public.journal_entries j on j.id=l.journal_entry_id
    where l.organization_id=p_organization_id and l.account_id=v_cash_account_id and j.organization_id=p_organization_id and j.status in ('posted','reversed')
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id);

  with bank_balances as (
    select b.id bank_id,b.account_id,b.bank_name,b.account_name,
      coalesce(sum(l.debit_amount-l.credit_amount) filter(where j.status in ('posted','reversed') and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)),0) balance
    from public.bank_accounts b join public.accounts a on a.id=b.account_id and a.organization_id=p_organization_id and a.is_active
    left join public.journal_lines l on l.account_id=b.account_id and l.organization_id=p_organization_id
    left join public.journal_entries j on j.id=l.journal_entry_id and j.organization_id=p_organization_id
    where b.organization_id=p_organization_id and b.is_active and (p_branch_id is null or b.branch_id is null or b.branch_id=p_branch_id)
    group by b.id,b.account_id,b.bank_name,b.account_name
  ) select coalesce(sum(balance),0),count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('bank_account_id',bank_id,'account_id',account_id,'name',bank_name||' · '||account_name,'balance',balance) order by bank_name,account_name),'[]'::jsonb)
    into v_bank,v_bank_count,v_banks from bank_balances;

  select coalesce(sum(oi.remaining_amount) filter(where oi.kind='receivable'),0),coalesce(sum(oi.remaining_amount) filter(where oi.kind='payable'),0),
    count(*) filter(where oi.kind='receivable')::integer,count(*) filter(where oi.kind='payable')::integer
    into v_receivables,v_payables,v_receivable_count,v_payable_count
    from public.open_items oi join public.journal_entries j on j.id=oi.source_journal_id and j.organization_id=p_organization_id
    where oi.organization_id=p_organization_id and oi.remaining_amount>0 and (p_branch_id is null or j.branch_id is not distinct from p_branch_id);

  with activity as (
    select i.invoice_date transaction_date,'Sales Invoice'::text transaction_type,i.id document_id,i.invoice_number document_number,c.name party_reference,i.grand_total amount,i.created_at,i.posted_journal_id,'/sales/invoices/'||i.id::text href
      from public.sales_invoices i join public.customers c on c.id=i.customer_id where i.organization_id=p_organization_id and i.status='posted' and (p_branch_id is null or i.branch_id is not distinct from p_branch_id)
    union all select b.bill_date,'Purchase Bill',b.id,b.bill_number,s.name,b.grand_total,b.created_at,b.posted_journal_id,'/purchases/bills/'||b.id::text
      from public.purchase_bills b join public.suppliers s on s.id=b.supplier_id where b.organization_id=p_organization_id and b.status='posted' and (p_branch_id is null or b.branch_id is not distinct from p_branch_id)
    union all select e.expense_date,'Expense',e.id,e.expense_number,coalesce(e.payee_name,e.reference,'—'),e.total_amount,e.created_at,e.posted_journal_id,'/expenses/'||e.id::text
      from public.expenses e where e.organization_id=p_organization_id and e.status='posted' and (p_branch_id is null or e.branch_id is not distinct from p_branch_id)
    union all select r.receipt_date,'Customer Receipt',r.id,r.receipt_number,c.name,r.amount,r.created_at,r.posted_journal_id,'/sales/customer-payments/'||r.id::text
      from public.customer_receipts r join public.customers c on c.id=r.customer_id where r.organization_id=p_organization_id and r.status='posted' and (p_branch_id is null or r.branch_id is not distinct from p_branch_id)
    union all select p.payment_date,'Supplier Payment',p.id,p.payment_number,s.name,p.amount,p.created_at,p.posted_journal_id,'/purchases/supplier-payments/'||p.id::text
      from public.supplier_payments p join public.suppliers s on s.id=p.supplier_id where p.organization_id=p_organization_id and p.status='posted' and (p_branch_id is null or p.branch_id is not distinct from p_branch_id)
    union all select n.credit_note_date,'Sales Credit Note',n.id,n.credit_note_number,c.name,n.grand_total,n.created_at,n.posted_journal_id,'/sales/credit-notes/'||n.id::text
      from public.sales_credit_notes n join public.customers c on c.id=n.customer_id where n.organization_id=p_organization_id and n.status='posted' and (p_branch_id is null or n.branch_id is not distinct from p_branch_id)
    union all select n.debit_note_date,'Purchase Debit Note',n.id,n.debit_note_number,s.name,n.grand_total,n.created_at,n.posted_journal_id,'/purchases/debit-notes/'||n.id::text
      from public.purchase_debit_notes n join public.suppliers s on s.id=n.supplier_id where n.organization_id=p_organization_id and n.status='posted' and (p_branch_id is null or n.branch_id is not distinct from p_branch_id)
  ), latest as (select * from activity order by transaction_date desc,created_at desc,document_number desc,document_id desc limit 8)
  select coalesce(jsonb_agg(jsonb_build_object('date',transaction_date,'type',transaction_type,'document_id',document_id,'document_number',document_number,'party_reference',party_reference,'amount',amount,'journal_id',posted_journal_id,'href',href) order by transaction_date desc,created_at desc,document_number desc,document_id desc),'[]'::jsonb)
    into v_activity from latest;

  return jsonb_build_object('organization_id',p_organization_id,'branch_id',p_branch_id,'cash_on_hand',v_cash,'cash_account_id',v_cash_account_id,
    'cash_at_bank',v_bank,'bank_account_count',v_bank_count,'bank_accounts',v_banks,'receivables',v_receivables,'receivable_count',v_receivable_count,
    'payables',v_payables,'payable_count',v_payable_count,'recent_activity',v_activity);
end; $$;
revoke all on function public.get_live_dashboard(uuid,uuid) from public,anon;
grant execute on function public.get_live_dashboard(uuid,uuid) to authenticated;
