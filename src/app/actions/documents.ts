"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const kindSchema = z.enum([
  "invoice",
  "bill",
  "credit-note",
  "debit-note",
  "receipt",
  "payment",
  "expense",
  "quotation",
  "delivery-note",
]);
const definitions: any = {
  quotation: {
    table:"sales_quotations", number:"quotation_number", date:"quotation_date", partyTable:"customers", partyKey:"customer_id", partyLabel:"Prepared for", lineTable:"sales_quotation_lines", lineFk:"quotation_id", title:"Quotation",
  },
  "delivery-note": {
    table:"delivery_notes", number:"delivery_note_number", date:"delivery_date", partyTable:"customers", partyKey:"customer_id", partyLabel:"Deliver to", lineTable:"delivery_note_lines", lineFk:"delivery_note_id", title:"Goods Delivery Note",
  },
  invoice: {
    table: "sales_invoices",
    number: "invoice_number",
    date: "invoice_date",
    partyTable: "customers",
    partyKey: "customer_id",
    partyLabel: "Bill to",
    lineTable: "sales_invoice_lines",
    lineFk: "invoice_id",
    title: "Tax Invoice",
    subtotal: "subtotal",
    tax: "tax_total",
    total: "grand_total",
  },
  bill: {
    table: "purchase_bills",
    number: "bill_number",
    date: "bill_date",
    partyTable: "suppliers",
    partyKey: "supplier_id",
    partyLabel: "Supplier",
    lineTable: "purchase_bill_lines",
    lineFk: "bill_id",
    title: "Purchase Bill",
    subtotal: "subtotal",
    tax: "tax_total",
    total: "grand_total",
  },
  "credit-note": {
    table: "sales_credit_notes",
    number: "credit_note_number",
    date: "credit_note_date",
    partyTable: "customers",
    partyKey: "customer_id",
    partyLabel: "Customer",
    lineTable: "sales_credit_note_lines",
    lineFk: "credit_note_id",
    title: "Tax Credit Note",
    subtotal: "subtotal",
    tax: "tax_total",
    total: "grand_total",
    sourceTable: "sales_invoices",
    sourceKey: "invoice_id",
    sourceNumber: "invoice_number",
  },
  "debit-note": {
    table: "purchase_debit_notes",
    number: "debit_note_number",
    date: "debit_note_date",
    partyTable: "suppliers",
    partyKey: "supplier_id",
    partyLabel: "Supplier",
    lineTable: "purchase_debit_note_lines",
    lineFk: "debit_note_id",
    title: "Purchase Debit Note",
    subtotal: "subtotal",
    tax: "tax_total",
    total: "grand_total",
    sourceTable: "purchase_bills",
    sourceKey: "bill_id",
    sourceNumber: "bill_number",
  },
  receipt: {
    table: "customer_receipts",
    number: "receipt_number",
    date: "receipt_date",
    partyTable: "customers",
    partyKey: "customer_id",
    partyLabel: "Received from",
    title: "Customer Receipt",
    total: "amount",
  },
  payment: {
    table: "supplier_payments",
    number: "payment_number",
    date: "payment_date",
    partyTable: "suppliers",
    partyKey: "supplier_id",
    partyLabel: "Paid to",
    title: "Supplier Payment",
    total: "amount",
  },
  expense: {
    table: "expenses",
    number: "expense_number",
    date: "expense_date",
    partyLabel: "Payee",
    title: "Expense Voucher",
    subtotal: "net_amount",
    tax: "tax_amount",
    total: "total_amount",
  },
};
export async function getPrintDocument(kindInput: string, idInput: string) {
  const k = kindSchema.safeParse(kindInput),
    id = z.string().uuid().safeParse(idInput);
  if (!k.success || !id.success)
    return { error: "Invalid document reference." };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      org = context.organization.id,
      d = definitions[k.data];
    const { data: record, error } = await (client.from(d.table) as any)
      .select("*")
      .eq("id", id.data)
      .eq("organization_id", org)
      .single();
    if (error || !record)
      return { error: "Document not found or access denied." };
    let party: any = null,
      lines: any[] = [],
      source: any = null,
      allocations: any[] = [];
    const relationships: any[] = [];
    if (d.partyTable) {
      const result = await (client.from(d.partyTable) as any)
        .select("id,name,trn,email,phone,billing_address")
        .eq("id", record[d.partyKey])
        .eq("organization_id", org)
        .single();
      party = result.data;
    }
    if (d.lineTable) {
      const result = await (client.from(d.lineTable) as any)
        .select("*,tax_rates(code,name,rate_percent),products(name,sku,inventory_units(code))")
        .eq(d.lineFk, id.data)
        .eq("organization_id", org)
        .order("id");
      lines = result.data || [];
    }
    if (d.sourceTable && record[d.sourceKey]) {
      const result = await (client.from(d.sourceTable) as any)
        .select(`id,${d.sourceNumber}`)
        .eq("id", record[d.sourceKey])
        .eq("organization_id", org)
        .single();
      source = result.data;
    }
    if (k.data === "receipt" || k.data === "payment") {
      const key =
          k.data === "receipt" ? "customer_receipt_id" : "supplier_payment_id",
        result = await client
          .from("open_item_allocations")
          .select("amount,open_items(source_document_id)")
          .eq("organization_id", org)
          .eq(key, id.data);
      allocations = result.data || [];
      const sourceIds = allocations
        .map((row: any) => row.open_items?.source_document_id)
        .filter(Boolean);
      if (sourceIds.length) {
        const sourceDefinition =
          k.data === "receipt"
            ? { table: "sales_invoices", number: "invoice_number" }
            : { table: "purchase_bills", number: "bill_number" };
        const sourceRows = await (client.from(sourceDefinition.table) as any)
          .select(`id,${sourceDefinition.number}`)
          .eq("organization_id", org)
          .in("id", sourceIds);
        const sourceMap = new Map(
          (sourceRows.data || []).map((row: any) => [
            row.id,
            row[sourceDefinition.number],
          ]),
        );
        allocations = allocations.map((row: any) => ({
          ...row,
          sourceNumber:
            sourceMap.get(row.open_items?.source_document_id) ||
            row.open_items?.source_document_id,
        }));
      }
    }
    if (["quotation", "delivery-note", "invoice"].includes(k.data)) {
      const related = await client
        .from("document_conversion_lines")
        .select("source_type,source_document_id,target_type,target_document_id")
        .eq("organization_id", org)
        .or(`source_document_id.eq.${id.data},target_document_id.eq.${id.data}`);
      const specs = new Map<string, { type: string; id: string; direction: string }>();
      for (const row of related.data || []) {
        if (row.source_document_id !== id.data)
          specs.set(`source:${row.source_type}:${row.source_document_id}`, { type: row.source_type, id: row.source_document_id, direction: "Source" });
        if (row.target_document_id !== id.data)
          specs.set(`target:${row.target_type}:${row.target_document_id}`, { type: row.target_type, id: row.target_document_id, direction: "Converted to" });
      }
      const relationDefinitions: Record<string, { table: string; number: string; href: (id: string) => string; label: string }> = {
        quotation: { table: "sales_quotations", number: "quotation_number", href: (x) => `/documents/quotation/${x}`, label: "Quotation" },
        delivery_note: { table: "delivery_notes", number: "delivery_note_number", href: (x) => `/documents/delivery-note/${x}`, label: "Delivery Note" },
        sales_invoice: { table: "sales_invoices", number: "invoice_number", href: (x) => `/sales/invoices/${x}`, label: "Sales Invoice" },
      };
      for (const spec of specs.values()) {
        const definition = relationDefinitions[spec.type];
        if (!definition) continue;
        const result = await (client.from(definition.table) as any).select(`id,${definition.number}`).eq("organization_id", org).eq("id", spec.id).maybeSingle();
        if (result.data) relationships.push({ direction: spec.direction, label: definition.label, number: result.data[definition.number], href: definition.href(spec.id) });
      }
    }
    const branch =
      context.payload.allBranches.find((x) => x.id === record.branch_id) ||
      null;
    const calculatedSubtotal=lines.reduce((sum:any,line:any)=>sum+Number(line.quantity)*Number(line.unit_price)-Number(line.discount||0),0),
      calculatedTax=lines.reduce((sum:any,line:any)=>{const net=Number(line.quantity)*Number(line.unit_price)-Number(line.discount||0);return sum+net*Number(line.tax_rates?.rate_percent||0)/100},0);
    return {
      document: {
        kind: k.data,
        title: d.title,
        number: record[d.number] || "Draft",
        date: record[d.date],
        status: record.status,
        reference: record.reference || "",
        notes: record.notes || "",
        postedJournalId: record.posted_journal_id,
        subtotal: d.subtotal ? Number(record[d.subtotal] || 0) : calculatedSubtotal,
        tax: d.tax ? Number(record[d.tax] || 0) : calculatedTax,
        total: d.total ? Number(record[d.total] || 0) : calculatedSubtotal+calculatedTax,
        payee: k.data === "expense" ? record.payee_name || "—" : null,
      },
      organization: context.organization,
      branch,
      party,
      partyLabel: d.partyLabel,
      lines,
      source: source ? { id: source.id, number: source[d.sourceNumber] } : null,
      allocations,
      relationships,
    };
  } catch {
    return { error: "Unable to prepare this document for printing." };
  }
}
