-- Batch 10.1: UAE-friendly VAT reporting from posted source documents and VAT ledger accounts.

create index if not exists sales_invoices_vat_report_idx
  on public.sales_invoices (organization_id, invoice_date, branch_id)
  where status = 'posted';
create index if not exists purchase_bills_vat_report_idx
  on public.purchase_bills (organization_id, bill_date, branch_id)
  where status = 'posted';
create index if not exists sales_credit_notes_vat_report_idx
  on public.sales_credit_notes (organization_id, credit_note_date, branch_id)
  where status = 'posted';
create index if not exists purchase_debit_notes_vat_report_idx
  on public.purchase_debit_notes (organization_id, debit_note_date, branch_id)
  where status = 'posted';
create index if not exists expenses_vat_report_idx
  on public.expenses (organization_id, expense_date, branch_id)
  where status = 'posted';
create index if not exists sales_invoice_lines_vat_report_idx
  on public.sales_invoice_lines (invoice_id, tax_rate_id);
create index if not exists purchase_bill_lines_vat_report_idx
  on public.purchase_bill_lines (bill_id, tax_rate_id);
create index if not exists sales_credit_note_lines_vat_report_idx
  on public.sales_credit_note_lines (credit_note_id, tax_rate_id);
create index if not exists purchase_debit_note_lines_vat_report_idx
  on public.purchase_debit_note_lines (debit_note_id, tax_rate_id);

create or replace function public.get_vat_report(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_transaction_type text default null,
  p_tax_rate_id uuid default null,
  p_party_type text default null,
  p_party_id uuid default null
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
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception 'Invalid VAT period';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.organization_id = p_organization_id
  ) then
    raise exception 'Invalid branch';
  end if;
  if p_transaction_type is not null and p_transaction_type not in (
    'sales_invoice', 'sales_credit_note', 'purchase_bill', 'purchase_debit_note', 'expense'
  ) then
    raise exception 'Invalid VAT transaction type';
  end if;
  if p_tax_rate_id is not null and not exists (
    select 1 from public.tax_rates t
    where t.id = p_tax_rate_id and t.organization_id = p_organization_id
  ) then
    raise exception 'Invalid tax rate';
  end if;
  if (p_party_type is null) <> (p_party_id is null) or
     (p_party_type is not null and p_party_type not in ('customer', 'supplier')) then
    raise exception 'Invalid party filter';
  end if;
  if p_party_type = 'customer' and not exists (
    select 1 from public.customers c
    where c.id = p_party_id and c.organization_id = p_organization_id
  ) then
    raise exception 'Invalid customer';
  end if;
  if p_party_type = 'supplier' and not exists (
    select 1 from public.suppliers s
    where s.id = p_party_id and s.organization_id = p_organization_id
  ) then
    raise exception 'Invalid supplier';
  end if;

  with transaction_rows as (
    select
      i.invoice_date transaction_date,
      'sales_invoice'::text transaction_type,
      'Sales Invoice'::text transaction_label,
      i.id source_document_id,
      i.invoice_number document_number,
      'customer'::text party_type,
      i.customer_id party_id,
      c.name party_name,
      c.trn party_trn,
      round(sum(l.quantity * l.unit_price - l.discount), 6) net_amount,
      round(sum(case when t.treatment in ('standard', 'zero_rated') then l.quantity * l.unit_price - l.discount else 0 end), 6) taxable_amount,
      round(sum((l.quantity * l.unit_price - l.discount) * coalesce(t.rate_percent, 0) / 100), 6) vat_amount,
      round(sum((l.quantity * l.unit_price - l.discount) * (1 + coalesce(t.rate_percent, 0) / 100)), 6) gross_amount,
      l.tax_rate_id,
      t.code tax_rate_code,
      t.name tax_rate_name,
      t.rate_percent,
      t.treatment::text tax_treatment,
      i.branch_id,
      b.name branch_name,
      i.posted_journal_id journal_id,
      j.journal_number,
      i.created_at
    from public.sales_invoices i
    join public.sales_invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id
    join public.customers c on c.id = i.customer_id and c.organization_id = i.organization_id
    left join public.tax_rates t on t.id = l.tax_rate_id and t.organization_id = i.organization_id
    left join public.branches b on b.id = i.branch_id
    left join public.journal_entries j on j.id = i.posted_journal_id and j.organization_id = i.organization_id
    where i.organization_id = p_organization_id and i.status = 'posted'
      and i.invoice_date between p_from and p_to
      and (p_branch_id is null or i.branch_id is not distinct from p_branch_id)
    group by i.invoice_date,i.id,i.invoice_number,i.customer_id,c.name,c.trn,l.tax_rate_id,t.code,t.name,t.rate_percent,t.treatment,i.branch_id,b.name,i.posted_journal_id,j.journal_number,i.created_at

    union all
    select
      n.credit_note_date,
      'sales_credit_note',
      'Sales Credit Note',
      n.id,
      n.credit_note_number,
      'customer',
      n.customer_id,
      c.name,
      c.trn,
      -round(sum(l.quantity * l.unit_price - l.discount), 6),
      -round(sum(case when t.treatment in ('standard', 'zero_rated') then l.quantity * l.unit_price - l.discount else 0 end), 6),
      -round(sum((l.quantity * l.unit_price - l.discount) * coalesce(t.rate_percent, 0) / 100), 6),
      -round(sum((l.quantity * l.unit_price - l.discount) * (1 + coalesce(t.rate_percent, 0) / 100)), 6),
      l.tax_rate_id,
      t.code,
      t.name,
      t.rate_percent,
      t.treatment::text,
      n.branch_id,
      b.name,
      n.posted_journal_id,
      j.journal_number,
      n.created_at
    from public.sales_credit_notes n
    join public.sales_credit_note_lines l on l.credit_note_id = n.id and l.organization_id = n.organization_id
    join public.customers c on c.id = n.customer_id and c.organization_id = n.organization_id
    left join public.tax_rates t on t.id = l.tax_rate_id and t.organization_id = n.organization_id
    left join public.branches b on b.id = n.branch_id
    left join public.journal_entries j on j.id = n.posted_journal_id and j.organization_id = n.organization_id
    where n.organization_id = p_organization_id and n.status = 'posted'
      and n.credit_note_date between p_from and p_to
      and (p_branch_id is null or n.branch_id is not distinct from p_branch_id)
    group by n.credit_note_date,n.id,n.credit_note_number,n.customer_id,c.name,c.trn,l.tax_rate_id,t.code,t.name,t.rate_percent,t.treatment,n.branch_id,b.name,n.posted_journal_id,j.journal_number,n.created_at

    union all
    select
      d.bill_date,
      'purchase_bill',
      'Purchase Bill',
      d.id,
      d.bill_number,
      'supplier',
      d.supplier_id,
      s.name,
      s.trn,
      round(sum(l.quantity * l.unit_price - l.discount), 6),
      round(sum(case when t.treatment in ('standard', 'zero_rated') then l.quantity * l.unit_price - l.discount else 0 end), 6),
      round(sum((l.quantity * l.unit_price - l.discount) * coalesce(t.rate_percent, 0) / 100), 6),
      round(sum((l.quantity * l.unit_price - l.discount) * (1 + coalesce(t.rate_percent, 0) / 100)), 6),
      l.tax_rate_id,
      t.code,
      t.name,
      t.rate_percent,
      t.treatment::text,
      d.branch_id,
      b.name,
      d.posted_journal_id,
      j.journal_number,
      d.created_at
    from public.purchase_bills d
    join public.purchase_bill_lines l on l.bill_id = d.id and l.organization_id = d.organization_id
    join public.suppliers s on s.id = d.supplier_id and s.organization_id = d.organization_id
    left join public.tax_rates t on t.id = l.tax_rate_id and t.organization_id = d.organization_id
    left join public.branches b on b.id = d.branch_id
    left join public.journal_entries j on j.id = d.posted_journal_id and j.organization_id = d.organization_id
    where d.organization_id = p_organization_id and d.status = 'posted'
      and d.bill_date between p_from and p_to
      and (p_branch_id is null or d.branch_id is not distinct from p_branch_id)
    group by d.bill_date,d.id,d.bill_number,d.supplier_id,s.name,s.trn,l.tax_rate_id,t.code,t.name,t.rate_percent,t.treatment,d.branch_id,b.name,d.posted_journal_id,j.journal_number,d.created_at

    union all
    select
      n.debit_note_date,
      'purchase_debit_note',
      'Purchase Debit Note',
      n.id,
      n.debit_note_number,
      'supplier',
      n.supplier_id,
      s.name,
      s.trn,
      -round(sum(l.quantity * l.unit_price - l.discount), 6),
      -round(sum(case when t.treatment in ('standard', 'zero_rated') then l.quantity * l.unit_price - l.discount else 0 end), 6),
      -round(sum((l.quantity * l.unit_price - l.discount) * coalesce(t.rate_percent, 0) / 100), 6),
      -round(sum((l.quantity * l.unit_price - l.discount) * (1 + coalesce(t.rate_percent, 0) / 100)), 6),
      l.tax_rate_id,
      t.code,
      t.name,
      t.rate_percent,
      t.treatment::text,
      n.branch_id,
      b.name,
      n.posted_journal_id,
      j.journal_number,
      n.created_at
    from public.purchase_debit_notes n
    join public.purchase_debit_note_lines l on l.debit_note_id = n.id and l.organization_id = n.organization_id
    join public.suppliers s on s.id = n.supplier_id and s.organization_id = n.organization_id
    left join public.tax_rates t on t.id = l.tax_rate_id and t.organization_id = n.organization_id
    left join public.branches b on b.id = n.branch_id
    left join public.journal_entries j on j.id = n.posted_journal_id and j.organization_id = n.organization_id
    where n.organization_id = p_organization_id and n.status = 'posted'
      and n.debit_note_date between p_from and p_to
      and (p_branch_id is null or n.branch_id is not distinct from p_branch_id)
    group by n.debit_note_date,n.id,n.debit_note_number,n.supplier_id,s.name,s.trn,l.tax_rate_id,t.code,t.name,t.rate_percent,t.treatment,n.branch_id,b.name,n.posted_journal_id,j.journal_number,n.created_at

    union all
    select
      e.expense_date,
      'expense',
      'Expense',
      e.id,
      e.expense_number,
      null::text,
      null::uuid,
      coalesce(nullif(e.payee_name, ''), 'Expense'),
      null::text,
      e.net_amount,
      case when t.treatment in ('standard', 'zero_rated') then e.net_amount else 0 end,
      e.tax_amount,
      e.total_amount,
      e.tax_rate_id,
      t.code,
      t.name,
      t.rate_percent,
      t.treatment::text,
      e.branch_id,
      b.name,
      e.posted_journal_id,
      j.journal_number,
      e.created_at
    from public.expenses e
    left join public.tax_rates t on t.id = e.tax_rate_id and t.organization_id = e.organization_id
    left join public.branches b on b.id = e.branch_id
    left join public.journal_entries j on j.id = e.posted_journal_id and j.organization_id = e.organization_id
    where e.organization_id = p_organization_id and e.status = 'posted'
      and e.expense_date between p_from and p_to
      and (p_branch_id is null or e.branch_id is not distinct from p_branch_id)
  ), filtered_rows as (
    select * from transaction_rows r
    where (p_transaction_type is null or r.transaction_type = p_transaction_type)
      and (p_tax_rate_id is null or r.tax_rate_id = p_tax_rate_id)
      and (p_party_id is null or (r.party_type = p_party_type and r.party_id = p_party_id))
  ), summary as (
    select
      coalesce(sum(taxable_amount) filter (where transaction_type = 'sales_invoice'), 0) taxable_sales,
      coalesce(sum(vat_amount) filter (where transaction_type = 'sales_invoice'), 0) output_vat,
      -coalesce(sum(taxable_amount) filter (where transaction_type = 'sales_credit_note'), 0) sales_credit_taxable,
      -coalesce(sum(vat_amount) filter (where transaction_type = 'sales_credit_note'), 0) sales_credit_vat,
      coalesce(sum(taxable_amount) filter (where transaction_type in ('sales_invoice','sales_credit_note')), 0) net_taxable_sales,
      coalesce(sum(vat_amount) filter (where transaction_type in ('sales_invoice','sales_credit_note')), 0) net_output_vat,
      coalesce(sum(taxable_amount) filter (where transaction_type in ('purchase_bill','expense')), 0) taxable_purchases_expenses,
      coalesce(sum(vat_amount) filter (where transaction_type in ('purchase_bill','expense')), 0) input_vat,
      -coalesce(sum(taxable_amount) filter (where transaction_type = 'purchase_debit_note'), 0) debit_note_taxable,
      -coalesce(sum(vat_amount) filter (where transaction_type = 'purchase_debit_note'), 0) debit_note_vat,
      coalesce(sum(taxable_amount) filter (where transaction_type in ('purchase_bill','purchase_debit_note','expense')), 0) net_taxable_purchases_expenses,
      coalesce(sum(vat_amount) filter (where transaction_type in ('purchase_bill','purchase_debit_note','expense')), 0) net_input_vat
    from transaction_rows
  ), gl as (
    select
      coalesce(sum(case when a.system_key = 'output_vat' then l.credit_amount - l.debit_amount else 0 end), 0) output_vat_gl,
      coalesce(sum(case when a.system_key = 'input_vat' then l.debit_amount - l.credit_amount else 0 end), 0) input_vat_gl,
      coalesce(sum(case when a.system_key = 'output_vat' and not (
        j.source_type in ('sales_invoice', 'sales_credit_note') and j.source_id is not null
      ) then l.credit_amount - l.debit_amount else 0 end), 0) output_other_vat_gl,
      coalesce(sum(case when a.system_key = 'input_vat' and not (
        j.source_type in ('purchase_bill', 'purchase_debit_note', 'expense') and j.source_id is not null
      ) then l.debit_amount - l.credit_amount else 0 end), 0) input_other_vat_gl
    from public.journal_entries j
    join public.journal_lines l on l.journal_entry_id = j.id and l.organization_id = p_organization_id
    join public.accounts a on a.id = l.account_id and a.organization_id = p_organization_id
    where j.organization_id = p_organization_id
      and j.status in ('posted', 'reversed')
      and j.journal_date between p_from and p_to
      and a.system_key in ('output_vat', 'input_vat')
      and (p_branch_id is null or j.branch_id is not distinct from p_branch_id)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transactionDate', r.transaction_date,
        'transactionType', r.transaction_type,
        'transactionLabel', r.transaction_label,
        'documentId', r.source_document_id,
        'documentNumber', r.document_number,
        'partyType', r.party_type,
        'partyId', r.party_id,
        'partyName', r.party_name,
        'partyTrn', r.party_trn,
        'netAmount', r.net_amount,
        'taxableAmount', r.taxable_amount,
        'vatAmount', r.vat_amount,
        'grossAmount', r.gross_amount,
        'taxRateId', r.tax_rate_id,
        'taxRateCode', r.tax_rate_code,
        'taxRateName', r.tax_rate_name,
        'ratePercent', coalesce(r.rate_percent, 0),
        'taxTreatment', r.tax_treatment,
        'branchId', r.branch_id,
        'branchName', r.branch_name,
        'journalId', r.journal_id,
        'journalNumber', r.journal_number
      ) order by r.transaction_date desc, r.created_at desc, r.document_number, r.tax_rate_code nulls last, r.source_document_id)
      from filtered_rows r
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'taxableSales', s.taxable_sales,
      'outputVat', s.output_vat,
      'salesCreditTaxable', s.sales_credit_taxable,
      'salesCreditVat', s.sales_credit_vat,
      'netTaxableSales', s.net_taxable_sales,
      'netOutputVat', s.net_output_vat,
      'taxablePurchasesExpenses', s.taxable_purchases_expenses,
      'inputVat', s.input_vat,
      'debitNoteTaxable', s.debit_note_taxable,
      'debitNoteVat', s.debit_note_vat,
      'netTaxablePurchasesExpenses', s.net_taxable_purchases_expenses,
      'netInputVat', s.net_input_vat,
      'netVatPosition', s.net_output_vat - s.net_input_vat
    ),
    'reconciliation', jsonb_build_object(
      'output', jsonb_build_object(
        'transactionDerived', s.net_output_vat,
        'manualOtherAdjustments', g.output_other_vat_gl,
        'glTotal', g.output_vat_gl,
        'difference', s.net_output_vat + g.output_other_vat_gl - g.output_vat_gl
      ),
      'input', jsonb_build_object(
        'transactionDerived', s.net_input_vat,
        'manualOtherAdjustments', g.input_other_vat_gl,
        'glTotal', g.input_vat_gl,
        'difference', s.net_input_vat + g.input_other_vat_gl - g.input_vat_gl
      )
    )
  ) into v_result
  from summary s cross join gl g;

  return v_result;
end;
$$;

revoke all on function public.get_vat_report(uuid,date,date,uuid,text,uuid,text,uuid) from public, anon;
grant execute on function public.get_vat_report(uuid,date,date,uuid,text,uuid,text,uuid) to authenticated;
