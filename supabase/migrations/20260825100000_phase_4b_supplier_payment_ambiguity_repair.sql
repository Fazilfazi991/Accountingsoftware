-- The original Phase 4B poster is now post_supplier_payment_internal.  Its
-- `oi` PL/pgSQL record and SQL alias collided in the join predicate below.
-- Keep the public wrapper, security posture, and settlement semantics intact.
create or replace function public.post_supplier_payment_internal(
  p_organization_id uuid,
  p_payment_id uuid,
  p_allocations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  d public.supplier_payments%rowtype;
  x jsonb;
  v_target_open_item public.open_items%rowtype;
  v_total numeric(20,6) := 0;
  v_amount numeric(20,6);
  v_ap uuid;
  v_journal uuid := gen_random_uuid();
  v_n bigint;
  v_prefix text;
  v_padding smallint;
  v_suffix text;
begin
  perform public.assert_accounting_owner(p_organization_id);
  select * into d from public.supplier_payments where id = p_payment_id and organization_id = p_organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if d.status = 'posted' then return jsonb_build_object('payment_id', d.id, 'journal_id', d.posted_journal_id, 'already_posted', true); end if;
  perform public.assert_settlement_cash_account(p_organization_id, d.cash_account_id, d.branch_id);
  if jsonb_typeof(p_allocations) <> 'array' then raise exception 'invalid_allocations'; end if;
  for x in select value from jsonb_array_elements(p_allocations) loop
    v_amount := (x->>'amount')::numeric;
    select target_open_item.* into v_target_open_item
      from public.open_items as target_open_item
      join public.purchase_bills as source_bill
        on source_bill.id = target_open_item.source_document_id
       and source_bill.organization_id = p_organization_id
       and source_bill.status = 'posted'
     where target_open_item.id = (x->>'open_item_id')::uuid
       and target_open_item.organization_id = p_organization_id
     for update;
    if not found
       or v_target_open_item.kind <> 'payable'
       or v_target_open_item.supplier_id <> d.supplier_id
       or v_amount <= 0
       or v_amount > v_target_open_item.remaining_amount then
      raise exception 'invalid_supplier_payment_allocation';
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_total <> d.amount then raise exception 'payment_allocation_must_equal_amount'; end if;
  select id into v_ap from public.accounts where organization_id = p_organization_id and system_key = 'accounts_payable' and is_active;
  if v_ap is null then raise exception 'system_account_missing'; end if;
  insert into public.journal_entries(id,organization_id,branch_id,journal_date,source_type,source_id,description,created_by)
    values(v_journal,p_organization_id,d.branch_id,d.payment_date,'supplier_payment',d.id,'Supplier payment',auth.uid());
  insert into public.journal_lines(organization_id,journal_entry_id,line_number,account_id,description,debit_amount,credit_amount,party_type,party_id,branch_id)
    values(p_organization_id,v_journal,1,v_ap,'Accounts payable',d.amount,0,'supplier',d.supplier_id,d.branch_id),
          (p_organization_id,v_journal,2,d.cash_account_id,'Supplier payment',0,d.amount,'supplier',d.supplier_id,d.branch_id);
  insert into public.document_sequences(organization_id,document_type,prefix) values(p_organization_id,'payment','PAY-')
    on conflict (organization_id,branch_id,document_type,financial_year_id) do nothing;
  select prefix,padding,suffix,next_number into v_prefix,v_padding,v_suffix,v_n from public.document_sequences
    where organization_id=p_organization_id and document_type='payment' and branch_id is null and financial_year_id is null for update;
  if v_n is null then raise exception 'payment_sequence_missing'; end if;
  update public.document_sequences set next_number=v_n+1 where organization_id=p_organization_id and document_type='payment' and branch_id is null and financial_year_id is null;
  update public.journal_entries set reference=v_prefix||lpad(v_n::text,v_padding,'0')||coalesce(v_suffix,'') where id=v_journal;
  perform public.post_journal_entry(p_organization_id,v_journal);
  for x in select value from jsonb_array_elements(p_allocations) loop
    v_amount := (x->>'amount')::numeric;
    update public.open_items set remaining_amount=remaining_amount-v_amount,status=case when remaining_amount-v_amount=0 then 'settled' else 'partial' end where id=(x->>'open_item_id')::uuid;
    insert into public.open_item_allocations(organization_id,open_item_id,supplier_payment_id,amount) values(p_organization_id,(x->>'open_item_id')::uuid,d.id,v_amount);
  end loop;
  update public.supplier_payments set payment_number=v_prefix||lpad(v_n::text,v_padding,'0')||coalesce(v_suffix,''),status='posted',posted_journal_id=v_journal,posted_at=now(),posted_by=auth.uid() where id=d.id;
  perform public.accounting_audit(p_organization_id,'supplier_payment.posted','supplier_payment',d.id,jsonb_build_object('journal_id',v_journal));
  return jsonb_build_object('payment_id',d.id,'journal_id',v_journal,'already_posted',false);
end;
$$;
