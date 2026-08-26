"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid(),
  line = z.object({
    productId: uuid,
    description: z.string().trim().min(1).max(300),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    discount: z.coerce.number().min(0),
    taxRateId: uuid.optional(),
    accountId: uuid,
    locationId: uuid.optional(),
  });
const documentSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(["invoice", "bill"]),
  partyId: uuid,
  documentDate: z.string().date(),
  dueDate: z.string().date(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(line).min(1),
});
export type BusinessDocumentData = {
  branch: { id: string; name: string };
  customers: any[];
  suppliers: any[];
  products: any[];
  locations: any[];
  accounts: any[];
  taxRates: any[];
  summary: any[];
  invoices: any[];
  bills: any[];
  invoiceLines: any[];
  billLines: any[];
};
const errorMessage = (error: unknown) => {
  const raw = String(
    (error as { message?: string })?.message || error || "",
  ).toLowerCase();
  if (raw.includes("insufficient_stock"))
    return raw.replace("insufficient_stock:", "Insufficient stock:");
  if (raw.includes("inventory_location"))
    return "Choose an active stock location belonging to this branch.";
  if (raw.includes("inventory_product"))
    return "Choose an active product or service belonging to this organization.";
  if (raw.includes("branch_required"))
    return "A branch is required for inventory-tracked lines.";
  return "This document could not be saved or posted. Review its lines and accounting setup.";
};
export async function getBusinessDocumentData(): Promise<
  BusinessDocumentData | { error: string }
> {
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      org = context.organization.id,
      branch = context.branch.id;
    await client.rpc("initialize_inventory_foundation", {
      p_organization_id: org,
    });
    const [
      customers,
      suppliers,
      products,
      locations,
      accounts,
      taxRates,
      summary,
      invoices,
      bills,
      invoiceLines,
      billLines,
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
        .from("products")
        .select(
          "id,name,sku,kind,track_inventory,unit_id,sales_price,purchase_price,tax_rate_id,status,inventory_units(code)",
        )
        .eq("organization_id", org)
        .eq("status", "active")
        .order("name"),
      client
        .from("inventory_locations")
        .select("id,name,code,is_default,branch_id,status")
        .eq("organization_id", org)
        .eq("branch_id", branch)
        .eq("status", "active")
        .order("name"),
      client
        .from("accounts")
        .select("id,name,account_type,system_key")
        .eq("organization_id", org)
        .eq("is_active", true)
        .in("account_type", ["income", "expense", "asset"])
        .order("code"),
      client
        .from("tax_rates")
        .select("id,name,rate_percent,sales_enabled,purchase_enabled")
        .eq("organization_id", org)
        .eq("is_active", true),
      client.rpc("get_stock_summary", {
        p_organization_id: org,
        p_branch_id: branch,
        p_product_id: null,
        p_location_id: null,
      }),
      client
        .from("sales_invoices")
        .select("id,customer_id,invoice_date,due_date,reference,notes,status")
        .eq("organization_id", org)
        .eq("status", "draft"),
      client
        .from("purchase_bills")
        .select("id,supplier_id,bill_date,due_date,reference,notes,status")
        .eq("organization_id", org)
        .eq("status", "draft"),
      client
        .from("sales_invoice_lines")
        .select(
          "id,invoice_id,description,quantity,unit_price,discount,tax_rate_id,revenue_account_id,product_id,inventory_location_id",
        )
        .eq("organization_id", org),
      client
        .from("purchase_bill_lines")
        .select(
          "id,bill_id,description,quantity,unit_price,discount,tax_rate_id,expense_account_id,product_id,inventory_location_id",
        )
        .eq("organization_id", org),
    ]);
    const all = [
      customers,
      suppliers,
      products,
      locations,
      accounts,
      taxRates,
      summary,
      invoices,
      bills,
      invoiceLines,
      billLines,
    ];
    const failed = all.find((x) => x.error);
    if (failed?.error) return { error: errorMessage(failed.error) };
    return {
      branch: context.branch,
      customers: customers.data || [],
      suppliers: suppliers.data || [],
      products: products.data || [],
      locations: locations.data || [],
      accounts: accounts.data || [],
      taxRates: taxRates.data || [],
      summary: summary.data || [],
      invoices: invoices.data || [],
      bills: bills.data || [],
      invoiceLines: invoiceLines.data || [],
      billLines: billLines.data || [],
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
export async function saveBusinessDocument(
  input: z.infer<typeof documentSchema>,
) {
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success || parsed.data.dueDate < parsed.data.documentDate)
    return {
      error: "Enter a party, valid dates, and at least one valid line.",
    };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      p = parsed.data;
    const lines = p.lines.map((x) => ({
      description: x.description,
      quantity: x.quantity,
      unit_price: x.unitPrice,
      discount: x.discount,
      tax_rate_id: x.taxRateId || null,
      product_id: x.productId,
      inventory_location_id: x.locationId || null,
      ...(p.kind === "invoice"
        ? { revenue_account_id: x.accountId }
        : { expense_account_id: x.accountId }),
    }));
    const name =
      p.kind === "invoice"
        ? p.id
          ? "update_sales_invoice_draft"
          : "create_sales_invoice_draft"
        : p.id
          ? "update_purchase_bill_draft"
          : "create_purchase_bill_draft";
    const args =
      p.kind === "invoice"
        ? p.id
          ? {
              p_organization_id: context.organization.id,
              p_invoice_id: p.id,
              p_customer_id: p.partyId,
              p_invoice_date: p.documentDate,
              p_due_date: p.dueDate,
              p_lines: lines,
              p_branch_id: context.branch.id,
              p_reference: p.reference || null,
              p_notes: p.notes || null,
            }
          : {
              p_organization_id: context.organization.id,
              p_customer_id: p.partyId,
              p_invoice_date: p.documentDate,
              p_due_date: p.dueDate,
              p_lines: lines,
              p_branch_id: context.branch.id,
              p_reference: p.reference || null,
              p_notes: p.notes || null,
            }
        : p.id
          ? {
              p_organization_id: context.organization.id,
              p_bill_id: p.id,
              p_supplier_id: p.partyId,
              p_bill_date: p.documentDate,
              p_due_date: p.dueDate,
              p_lines: lines,
              p_branch_id: context.branch.id,
              p_reference: p.reference || null,
              p_notes: p.notes || null,
            }
          : {
              p_organization_id: context.organization.id,
              p_supplier_id: p.partyId,
              p_bill_date: p.documentDate,
              p_due_date: p.dueDate,
              p_lines: lines,
              p_branch_id: context.branch.id,
              p_reference: p.reference || null,
              p_notes: p.notes || null,
            };
    const { data, error } = await client.rpc(name, args);
    if (error) return { error: errorMessage(error) };
    revalidatePath("/", "layout");
    return { id: p.id || String(data) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
export async function postBusinessDocument(
  kind: "invoice" | "bill",
  id: string,
) {
  const parsed = z
    .object({ kind: z.enum(["invoice", "bill"]), id: uuid })
    .safeParse({ kind, id });
  if (!parsed.success) return { error: "Invalid document." };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient();
    const { data, error } = await client.rpc(
      kind === "invoice" ? "post_sales_invoice" : "post_purchase_bill",
      {
        p_organization_id: context.organization.id,
        ...(kind === "invoice" ? { p_invoice_id: id } : { p_bill_id: id }),
      },
    );
    if (error) return { error: errorMessage(error) };
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
export async function deleteBusinessDocument(
  kind: "invoice" | "bill",
  id: string,
) {
  try {
    const context = await requireOrganizationContext(),
      client = await createClient();
    const { error } = await client.rpc(
      kind === "invoice"
        ? "delete_sales_invoice_draft"
        : "delete_purchase_bill_draft",
      {
        p_organization_id: context.organization.id,
        ...(kind === "invoice" ? { p_invoice_id: id } : { p_bill_id: id }),
      },
    );
    if (error) return { error: errorMessage(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
