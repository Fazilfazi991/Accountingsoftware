-- Remove the recursive global cast and type settlement CASE branches directly.
drop cast if exists (text as public.open_item_status);
drop function if exists public.text_to_open_item_status(text);

do $$
declare v_target regprocedure; v_definition text;
begin
  foreach v_target in array array[
    'public.post_sales_credit_note(uuid,uuid)'::regprocedure,
    'public.post_purchase_debit_note(uuid,uuid)'::regprocedure,
    'public.post_customer_receipt_internal(uuid,uuid,jsonb)'::regprocedure,
    'public.post_supplier_payment_internal(uuid,uuid,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_target) into v_definition;
    v_definition:=replace(v_definition,
      $needle$then 'settled' else 'partial' end$needle$,
      $replacement$then 'settled'::public.open_item_status else 'partial'::public.open_item_status end$replacement$);
    execute v_definition;
  end loop;
end $$;
