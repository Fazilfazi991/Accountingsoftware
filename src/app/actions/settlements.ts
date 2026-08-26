"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string; journalId?: string } | { error: string };
const uuid = z.string().uuid();
const amount = z.number().finite().positive();
const date = z.string().date();
const text = z.string().trim().max(500).optional();

export type SettlementData = {
  organizationId: string;
  branchId: string;
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  accounts: { id: string; name: string; account_type: string }[];
  invoices: any[];
  bills: any[];
  invoiceLines: any[];
  billLines: any[];
  openItems: any[];
  creditNotes: any[];
  creditLines: any[];
  receipts: any[];
  debitNotes: any[];
  debitLines: any[];
  payments: any[];
  allocations: any[];
  taxRates: any[];
  products: any[];
  locations: any[];
};

function message(error: unknown) {
  const raw = String(
    (error as { message?: string })?.message || error || "",
  ).toLowerCase();
  if (raw.includes("credit_exceeds"))
    return "Credit exceeds remaining invoice amount.";
  if (raw.includes("debit_exceeds"))
    return "Debit exceeds remaining bill amount.";
  if (raw.includes("receipt_allocation_must_equal"))
    return "Allocation must equal receipt amount.";
  if (raw.includes("payment_allocation_must_equal"))
    return "Payment allocation must equal payment amount.";
  if (raw.includes("duplicate_or_missing"))
    return "Duplicate invoice or bill allocation is not allowed.";
  if (raw.includes("invalid_receipt_allocation"))
    return "Allocation exceeds invoice balance or belongs to another customer.";
  if (raw.includes("invalid_supplier_payment_allocation"))
    return "Allocation exceeds bill balance or belongs to another supplier.";
  if (raw.includes("invalid_cash_or_bank"))
    return "Select an active Cash or Bank account.";
  if (raw.includes("not_editable") || raw.includes("already_posted"))
    return "This document is already posted and cannot be changed.";
  if (
    raw.includes("not_found") ||
    raw.includes("permission") ||
    raw.includes("access")
  )
    return "You do not have access to this transaction.";
  return "This settlement could not be saved. Please review the form and try again.";
}

async function contextAndClient() {
  const context = await requireOrganizationContext();
  return { context, client: await createClient() };
}
const plain = (rows: unknown) => (rows || []) as any[];

export async function getSettlementData(): Promise<
  SettlementData | { error: string }
> {
  try {
    const { context, client } = await contextAndClient();
    const org = context.organization.id;
    const [
      customers,
      suppliers,
      accounts,
      invoices,
      bills,
      invoiceLines,
      billLines,
      openItems,
      creditNotes,
      creditLines,
      receipts,
      debitNotes,
      debitLines,
      payments,
      allocations,
      taxRates,
      products,
      locations,
    ] = await Promise.all([
      client
        .from("customers")
        .select("id,name")
        .eq("organization_id", org)
        .eq("is_active", true)
        .order("name"),
      client
        .from("suppliers")
        .select("id,name")
        .eq("organization_id", org)
        .eq("is_active", true)
        .order("name"),
      client
        .from("accounts")
        .select("id,name,account_type")
        .eq("organization_id", org)
        .eq("is_active", true)
        .in("account_type", ["cash", "bank"])
        .order("name"),
      client
        .from("sales_invoices")
        .select(
          "id,branch_id,customer_id,invoice_number,invoice_date,due_date,grand_total,status,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("invoice_date", { ascending: false }),
      client
        .from("purchase_bills")
        .select(
          "id,branch_id,supplier_id,bill_number,bill_date,due_date,grand_total,status,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("bill_date", { ascending: false }),
      client
        .from("sales_invoice_lines")
        .select(
          "id,invoice_id,description,quantity,unit_price,discount,tax_rate_id,product_id,inventory_location_id",
        )
        .eq("organization_id", org),
      client
        .from("purchase_bill_lines")
        .select(
          "id,bill_id,description,quantity,unit_price,discount,tax_rate_id,product_id,inventory_location_id",
        )
        .eq("organization_id", org),
      client
        .from("open_items")
        .select(
          "id,kind,customer_id,supplier_id,source_document_id,original_amount,remaining_amount,due_date,status",
        )
        .eq("organization_id", org),
      client
        .from("sales_credit_notes")
        .select(
          "id,customer_id,invoice_id,credit_note_number,credit_note_date,reference,notes,status,subtotal,tax_total,grand_total,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("created_at", { ascending: false }),
      client
        .from("sales_credit_note_lines")
        .select(
          "id,credit_note_id,source_invoice_line_id,description,quantity,unit_price,discount,tax_rate_id,product_id,inventory_location_id,return_to_stock",
        )
        .eq("organization_id", org),
      client
        .from("customer_receipts")
        .select(
          "id,customer_id,receipt_number,receipt_date,cash_account_id,amount,reference,notes,status,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("created_at", { ascending: false }),
      client
        .from("purchase_debit_notes")
        .select(
          "id,supplier_id,bill_id,debit_note_number,debit_note_date,reference,notes,status,subtotal,tax_total,grand_total,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("created_at", { ascending: false }),
      client
        .from("purchase_debit_note_lines")
        .select(
          "id,debit_note_id,source_bill_line_id,description,quantity,unit_price,discount,tax_rate_id,product_id,inventory_location_id,return_from_stock",
        )
        .eq("organization_id", org),
      client
        .from("supplier_payments")
        .select(
          "id,supplier_id,payment_number,payment_date,cash_account_id,amount,reference,notes,status,posted_journal_id",
        )
        .eq("organization_id", org)
        .order("created_at", { ascending: false }),
      client
        .from("open_item_allocations")
        .select(
          "open_item_id,customer_receipt_id,supplier_payment_id,sales_credit_note_id,purchase_debit_note_id,amount",
        )
        .eq("organization_id", org),
      client
        .from("tax_rates")
        .select("id,name,rate_percent")
        .eq("organization_id", org)
        .eq("is_active", true),
      client
        .from("products")
        .select(
          "id,name,sku,kind,track_inventory,unit_id,inventory_units(code)",
        )
        .eq("organization_id", org),
      client
        .from("inventory_locations")
        .select("id,name,branch_id,status")
        .eq("organization_id", org),
    ]);
    const failed = [
      customers,
      suppliers,
      accounts,
      invoices,
      bills,
      invoiceLines,
      billLines,
      openItems,
      creditNotes,
      creditLines,
      receipts,
      debitNotes,
      debitLines,
      payments,
      allocations,
      taxRates,
      products,
      locations,
    ].find((x) => x.error);
    if (failed?.error) return { error: message(failed.error) };
    return {
      organizationId: org,
      branchId: context.branch.id,
      customers: plain(customers.data),
      suppliers: plain(suppliers.data),
      accounts: plain(accounts.data),
      invoices: plain(invoices.data),
      bills: plain(bills.data),
      invoiceLines: plain(invoiceLines.data),
      billLines: plain(billLines.data),
      openItems: plain(openItems.data),
      creditNotes: plain(creditNotes.data),
      creditLines: plain(creditLines.data),
      receipts: plain(receipts.data),
      debitNotes: plain(debitNotes.data),
      debitLines: plain(debitLines.data),
      payments: plain(payments.data),
      allocations: plain(allocations.data),
      taxRates: plain(taxRates.data),
      products: plain(products.data),
      locations: plain(locations.data),
    };
  } catch (error) {
    return { error: message(error) };
  }
}

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Result> {
  try {
    const { client } = await contextAndClient();
    const { data, error } = await client.rpc(name, args);
    if (error) return { error: message(error) };
    revalidatePath("/", "layout");
    return {
      ok: true,
      ...(typeof data === "string" ? { id: data } : data || {}),
    };
  } catch (error) {
    return { error: message(error) };
  }
}

const lines = z
  .array(
    z.object({
      sourceLineId: uuid,
      quantity: amount,
      physicalReturn: z.boolean(),
    }),
  )
  .min(1);
export async function saveCreditNote(input: {
  id?: string;
  customerId: string;
  invoiceId: string;
  documentDate: string;
  reference?: string;
  notes?: string;
  lines: { sourceLineId: string; quantity: number; physicalReturn: boolean }[];
}): Promise<Result> {
  const parsed = z
    .object({
      id: uuid.optional(),
      customerId: uuid,
      invoiceId: uuid,
      documentDate: date,
      reference: text,
      notes: text,
      lines,
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      error: "Choose an invoice and enter a positive quantity to credit.",
    };
  const { context } = await contextAndClient();
  const p = parsed.data;
  const payload = p.lines.map((line) => ({
    source_invoice_line_id: line.sourceLineId,
    quantity: line.quantity,
    return_to_stock: line.physicalReturn,
  }));
  return p.id
    ? call("update_sales_credit_note_draft", {
        p_organization_id: context.organization.id,
        p_credit_note_id: p.id,
        p_credit_note_date: p.documentDate,
        p_lines: payload,
        p_reference: p.reference || null,
        p_notes: p.notes || null,
      })
    : call("create_sales_credit_note_draft", {
        p_organization_id: context.organization.id,
        p_customer_id: p.customerId,
        p_invoice_id: p.invoiceId,
        p_credit_note_date: p.documentDate,
        p_lines: payload,
        p_branch_id: context.branch.id,
        p_reference: p.reference || null,
        p_notes: p.notes || null,
      });
}
export async function postCreditNote(id: string) {
  const { context } = await contextAndClient();
  return call("post_sales_credit_note", {
    p_organization_id: context.organization.id,
    p_credit_note_id: id,
  });
}
export async function deleteCreditNote(id: string) {
  const { context } = await contextAndClient();
  return call("delete_sales_credit_note_draft", {
    p_organization_id: context.organization.id,
    p_credit_note_id: id,
  });
}

const payment = z.object({
  id: uuid.optional(),
  partyId: uuid,
  documentDate: date,
  accountId: uuid,
  amount,
  reference: text,
  notes: text,
});
export async function saveReceipt(
  input: z.infer<typeof payment>,
): Promise<Result> {
  const p = payment.safeParse(input);
  if (!p.success)
    return {
      error:
        "Choose a customer, active Cash or Bank account, date, and amount.",
    };
  const { context } = await contextAndClient();
  const d = p.data;
  return d.id
    ? call("update_customer_receipt_draft", {
        p_organization_id: context.organization.id,
        p_receipt_id: d.id,
        p_customer_id: d.partyId,
        p_receipt_date: d.documentDate,
        p_cash_account_id: d.accountId,
        p_amount: d.amount,
        p_branch_id: context.branch.id,
        p_reference: d.reference || null,
        p_notes: d.notes || null,
      })
    : call("create_customer_receipt_draft", {
        p_organization_id: context.organization.id,
        p_customer_id: d.partyId,
        p_receipt_date: d.documentDate,
        p_cash_account_id: d.accountId,
        p_amount: d.amount,
        p_allocations: [],
        p_branch_id: context.branch.id,
        p_reference: d.reference || null,
        p_notes: d.notes || null,
      });
}
export async function postReceipt(
  id: string,
  allocations: { openItemId: string; amount: number }[],
) {
  const { context } = await contextAndClient();
  return call("post_customer_receipt", {
    p_organization_id: context.organization.id,
    p_receipt_id: id,
    p_allocations: allocations.map((x) => ({
      open_item_id: x.openItemId,
      amount: x.amount,
    })),
  });
}
export async function deleteReceipt(id: string) {
  const { context } = await contextAndClient();
  return call("delete_customer_receipt_draft", {
    p_organization_id: context.organization.id,
    p_receipt_id: id,
  });
}

export async function saveDebitNote(input: {
  id?: string;
  supplierId: string;
  billId: string;
  documentDate: string;
  reference?: string;
  notes?: string;
  lines: { sourceLineId: string; quantity: number; physicalReturn: boolean }[];
}): Promise<Result> {
  const parsed = z
    .object({
      id: uuid.optional(),
      supplierId: uuid,
      billId: uuid,
      documentDate: date,
      reference: text,
      notes: text,
      lines,
    })
    .safeParse(input);
  if (!parsed.success)
    return { error: "Choose a bill and enter a positive quantity to debit." };
  const { context } = await contextAndClient();
  const p = parsed.data;
  const payload = p.lines.map((line) => ({
    source_bill_line_id: line.sourceLineId,
    quantity: line.quantity,
    return_from_stock: line.physicalReturn,
  }));
  return p.id
    ? call("update_purchase_debit_note_draft", {
        p_organization_id: context.organization.id,
        p_debit_note_id: p.id,
        p_debit_note_date: p.documentDate,
        p_lines: payload,
        p_reference: p.reference || null,
        p_notes: p.notes || null,
      })
    : call("create_purchase_debit_note_draft", {
        p_organization_id: context.organization.id,
        p_supplier_id: p.supplierId,
        p_bill_id: p.billId,
        p_debit_note_date: p.documentDate,
        p_lines: payload,
        p_branch_id: context.branch.id,
        p_reference: p.reference || null,
        p_notes: p.notes || null,
      });
}
export async function postDebitNote(id: string) {
  const { context } = await contextAndClient();
  return call("post_purchase_debit_note", {
    p_organization_id: context.organization.id,
    p_debit_note_id: id,
  });
}
export async function deleteDebitNote(id: string) {
  const { context } = await contextAndClient();
  return call("delete_purchase_debit_note_draft", {
    p_organization_id: context.organization.id,
    p_debit_note_id: id,
  });
}

export async function saveSupplierPayment(
  input: z.infer<typeof payment>,
): Promise<Result> {
  const p = payment.safeParse(input);
  if (!p.success)
    return {
      error:
        "Choose a supplier, active Cash or Bank account, date, and amount.",
    };
  const { context } = await contextAndClient();
  const d = p.data;
  return d.id
    ? call("update_supplier_payment_draft", {
        p_organization_id: context.organization.id,
        p_payment_id: d.id,
        p_supplier_id: d.partyId,
        p_payment_date: d.documentDate,
        p_cash_account_id: d.accountId,
        p_amount: d.amount,
        p_branch_id: context.branch.id,
        p_reference: d.reference || null,
        p_notes: d.notes || null,
      })
    : call("create_supplier_payment_draft", {
        p_organization_id: context.organization.id,
        p_supplier_id: d.partyId,
        p_payment_date: d.documentDate,
        p_cash_account_id: d.accountId,
        p_amount: d.amount,
        p_branch_id: context.branch.id,
        p_reference: d.reference || null,
        p_notes: d.notes || null,
      });
}
export async function postSupplierPayment(
  id: string,
  allocations: { openItemId: string; amount: number }[],
) {
  const { context } = await contextAndClient();
  return call("post_supplier_payment", {
    p_organization_id: context.organization.id,
    p_payment_id: id,
    p_allocations: allocations.map((x) => ({
      open_item_id: x.openItemId,
      amount: x.amount,
    })),
  });
}
export async function deleteSupplierPayment(id: string) {
  const { context } = await contextAndClient();
  return call("delete_supplier_payment_draft", {
    p_organization_id: context.organization.id,
    p_payment_id: id,
  });
}
