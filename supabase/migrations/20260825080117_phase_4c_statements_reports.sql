-- Phase 4C.2: reports derive only from posted party documents and open items.
create or replace function public.get_party_statement(
  p_organization_id uuid, p_party_type text, p_party_id uuid, p_from date, p_to date,
  p_branch_id uuid default null
) returns table(transaction_date date, transaction_type text, document_id uuid, document_number text,
  reference text, debit numeric, credit numeric, running_balance numeric, posted_journal_id uuid)
language sql security definer set search_path=pg_catalog,public as $$
  with activity as (
    select i.invoice_date transaction_date, 'Sales Invoice'::text transaction_type, i.id document_id, i.invoice_number document_number, i.reference,
      i.grand_total::numeric debit, 0::numeric credit, i.created_at, i.posted_journal_id
    from public.sales_invoices i where p_party_type='customer' and i.organization_id=p_organization_id
      and i.customer_id=p_party_id and i.status='posted' and (p_branch_id is null or i.branch_id is not distinct from p_branch_id)
    union all select c.credit_note_date, 'Sales Credit Note', c.id, c.credit_note_number, c.reference,
      0::numeric, c.grand_total::numeric, c.created_at, c.posted_journal_id
    from public.sales_credit_notes c where p_party_type='customer' and c.organization_id=p_organization_id
      and c.customer_id=p_party_id and c.status='posted' and (p_branch_id is null or c.branch_id is not distinct from p_branch_id)
    union all select r.receipt_date, 'Customer Receipt', r.id, r.receipt_number, r.reference,
      0::numeric, r.amount::numeric, r.created_at, r.posted_journal_id
    from public.customer_receipts r where p_party_type='customer' and r.organization_id=p_organization_id
      and r.customer_id=p_party_id and r.status='posted' and (p_branch_id is null or r.branch_id is not distinct from p_branch_id)
    union all select b.bill_date, 'Purchase Bill', b.id, b.bill_number, b.reference,
      b.grand_total::numeric, 0::numeric, b.created_at, b.posted_journal_id
    from public.purchase_bills b where p_party_type='supplier' and b.organization_id=p_organization_id
      and b.supplier_id=p_party_id and b.status='posted' and (p_branch_id is null or b.branch_id is not distinct from p_branch_id)
    union all select d.debit_note_date, 'Purchase Debit Note', d.id, d.debit_note_number, d.reference,
      0::numeric, d.grand_total::numeric, d.created_at, d.posted_journal_id
    from public.purchase_debit_notes d where p_party_type='supplier' and d.organization_id=p_organization_id
      and d.supplier_id=p_party_id and d.status='posted' and (p_branch_id is null or d.branch_id is not distinct from p_branch_id)
    union all select p.payment_date, 'Supplier Payment', p.id, p.payment_number, p.reference,
      0::numeric, p.amount::numeric, p.created_at, p.posted_journal_id
    from public.supplier_payments p where p_party_type='supplier' and p.organization_id=p_organization_id
      and p.supplier_id=p_party_id and p.status='posted' and (p_branch_id is null or p.branch_id is not distinct from p_branch_id)
  ), ranked as (
    select *, sum(debit-credit) over(order by transaction_date,created_at,document_number,document_id) running_balance
    from activity where transaction_date<=p_to
  )
  select transaction_date, transaction_type, document_id, document_number, reference, debit, credit, running_balance, posted_journal_id
  from ranked where transaction_date>=p_from and public.is_active_org_member(p_organization_id)
  order by transaction_date,created_at,document_number,document_id;
$$;

create or replace function public.get_open_item_report(
  p_organization_id uuid, p_kind public.open_item_kind, p_state text default 'open',
  p_as_of date default current_date, p_branch_id uuid default null
) returns table(open_item_id uuid, party_id uuid, party_name text, document_id uuid, document_number text,
  document_date date, due_date date, original_amount numeric, allocated_amount numeric, outstanding numeric,
  item_status text, age_days integer, bucket text, posted_journal_id uuid)
language sql security definer set search_path=pg_catalog,public as $$
  with rows as (
    select oi.id,oi.kind,oi.customer_id party_id,c.name party_name,i.id document_id,i.invoice_number document_number,
      i.invoice_date document_date,oi.due_date,oi.original_amount,oi.remaining_amount,oi.status::text,i.posted_journal_id,i.branch_id
    from public.open_items oi join public.sales_invoices i on i.id=oi.source_document_id join public.customers c on c.id=oi.customer_id
    where oi.organization_id=p_organization_id and oi.kind='receivable'
    union all select oi.id,oi.kind,oi.supplier_id,s.name,b.id,b.bill_number,b.bill_date,oi.due_date,oi.original_amount,oi.remaining_amount,oi.status::text,b.posted_journal_id,b.branch_id
    from public.open_items oi join public.purchase_bills b on b.id=oi.source_document_id join public.suppliers s on s.id=oi.supplier_id
    where oi.organization_id=p_organization_id and oi.kind='payable'
  ), data as (
    select r.*, r.status item_status, r.original_amount-r.remaining_amount allocated_amount,
      greatest(0,p_as_of-coalesce(r.due_date,r.document_date))::integer age_days
    from rows r where r.kind=p_kind and r.document_date<=p_as_of and (p_branch_id is null or r.branch_id is not distinct from p_branch_id)
  ) select id,party_id,party_name,document_id,document_number,document_date,due_date,original_amount,allocated_amount,remaining_amount,item_status,age_days,
    case when age_days=0 then 'Current' when age_days<=30 then '1–30' when age_days<=60 then '31–60' when age_days<=90 then '61–90' else '90+' end,posted_journal_id
  from data where (p_state='all' or (p_state='open' and item_status in ('open','partial')) or (p_state='settled' and item_status='settled'))
    and public.is_active_org_member(p_organization_id) order by party_name,document_date,document_number;
$$;

revoke all on function public.get_party_statement(uuid,text,uuid,date,date,uuid),public.get_open_item_report(uuid,public.open_item_kind,text,date,uuid) from public,anon;
grant execute on function public.get_party_statement(uuid,text,uuid,date,date,uuid),public.get_open_item_report(uuid,public.open_item_kind,text,date,uuid) to authenticated;
