-- Fresh production applies both the original membership SELECT policies and
-- later Phase 4 repair policies. Their predicates are equivalent, so retain
-- the original direct organization checks and remove the redundant policies.

drop policy if exists customers_phase4_member_select on public.customers;
drop policy if exists suppliers_phase4_member_select on public.suppliers;
drop policy if exists sales_invoices_phase4_member_select on public.sales_invoices;
drop policy if exists sales_invoice_lines_phase4_member_select on public.sales_invoice_lines;
drop policy if exists purchase_bills_phase4_member_select on public.purchase_bills;
drop policy if exists purchase_bill_lines_phase4_member_select on public.purchase_bill_lines;
drop policy if exists open_items_phase4_member_select on public.open_items;
