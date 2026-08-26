"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid(),
  quantity = z.coerce.number().positive().max(999999999999);
const productSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(["product", "service"]),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(80).optional(),
  category: z.string().trim().max(100).optional(),
  unitId: uuid.optional(),
  salesPrice: z.coerce.number().min(0),
  purchasePrice: z.coerce.number().min(0),
  taxRateId: uuid.optional(),
  trackInventory: z.boolean(),
  reorderLevel: z.coerce.number().min(0),
  active: z.boolean(),
});
const locationSchema = z.object({
  id: uuid.optional(),
  branchId: uuid,
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(32),
  isDefault: z.boolean(),
  active: z.boolean(),
});
const operationSchema = z.object({
  operationId: uuid,
  operationType: z.enum([
    "opening",
    "adjustment_in",
    "adjustment_out",
    "transfer",
  ]),
  date: z.string().date(),
  productId: uuid,
  sourceLocationId: uuid,
  destinationLocationId: uuid.optional(),
  quantity,
  unitCost: z.coerce.number().positive().optional(),
  reference: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type InventoryData = {
  products: any[];
  units: any[];
  locations: any[];
  summary: any[];
  movements: any[];
  valuation: any[];
  cogs: any[];
  taxRates: any[];
  branches: { id: string; name: string; active: boolean }[];
};

export async function getInventoryData(
  filters: {
    branchId?: string;
    productId?: string;
    locationId?: string;
    from?: string;
    to?: string;
    movementType?: string;
  } = {},
): Promise<InventoryData | { error: string }> {
  try {
    const context = await requireOrganizationContext(),
      client = await createClient();
    await client.rpc("initialize_inventory_foundation", {
      p_organization_id: context.organization.id,
    });
    const org = context.organization.id;
    const [
      products,
      units,
      locations,
      summary,
      movements,
      valuation,
      cogs,
      taxRates,
    ] = await Promise.all([
      client
        .from("products")
        .select(
          "id,kind,name,sku,category,unit_id,sales_price,purchase_price,track_inventory,reorder_level,tax_rate_id,status,inventory_units(code,name),tax_rates(code,rate_percent)",
        )
        .eq("organization_id", org)
        .order("name"),
      client
        .from("inventory_units")
        .select("id,code,name,status")
        .eq("organization_id", org)
        .order("code"),
      client
        .from("inventory_locations")
        .select("id,branch_id,name,code,is_default,status,branches!inventory_locations_branch_id_fkey(name)")
        .eq("organization_id", org)
        .order("name"),
      client.rpc("get_stock_summary", {
        p_organization_id: org,
        p_branch_id: filters.branchId || null,
        p_product_id: filters.productId || null,
        p_location_id: filters.locationId || null,
      }),
      client.rpc("get_stock_movement_report", {
        p_organization_id: org,
        p_branch_id: filters.branchId || null,
        p_product_id: filters.productId || null,
        p_location_id: filters.locationId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_movement_type: filters.movementType || null,
      }),
      client.rpc("get_inventory_valuation_report", {
        p_organization_id: org,
        p_product_id: filters.productId || null,
      }),
      client.rpc("get_inventory_cogs_report", {
        p_organization_id: org,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_product_id: filters.productId || null,
      }),
      client
        .from("tax_rates")
        .select("id,code,name,rate_percent")
        .eq("organization_id", org)
        .eq("is_active", true)
        .order("rate_percent"),
    ]);
    const failed = [
      products,
      units,
      locations,
      summary,
      movements,
      valuation,
      cogs,
      taxRates,
    ].find((x) => x.error);
    if (failed?.error) return { error: "Unable to load inventory data." };
    return {
      products: products.data || [],
      units: units.data || [],
      locations: locations.data || [],
      summary: summary.data || [],
      movements: movements.data || [],
      valuation: valuation.data || [],
      cogs: cogs.data || [],
      taxRates: taxRates.data || [],
      branches: context.payload.allBranches,
    };
  } catch {
    return { error: "Unable to load inventory data." };
  }
}

export async function saveInventoryProduct(
  value: z.infer<typeof productSchema>,
) {
  const parsed = productSchema.safeParse(value);
  if (!parsed.success) return { error: "Enter valid product details." };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      p = parsed.data;
    if (p.kind === "product" && p.trackInventory && !p.unitId)
      return { error: "Choose a unit for inventory-tracked products." };
    const row = {
      organization_id: context.organization.id,
      kind: p.kind,
      name: p.name,
      sku: p.sku || null,
      category: p.category || null,
      unit_id: p.kind === "product" ? p.unitId || null : null,
      sales_price: p.salesPrice,
      purchase_price: p.purchasePrice,
      tax_rate_id: p.taxRateId || null,
      track_inventory: p.kind === "product" && p.trackInventory,
      reorder_level: p.kind === "product" ? p.reorderLevel : 0,
      status: p.active ? "active" : "inactive",
    };
    const result = p.id
      ? await client
          .from("products")
          .update(row)
          .eq("id", p.id)
          .eq("organization_id", context.organization.id)
          .select("id")
          .single()
      : await client
          .from("products")
          .insert({ ...row, created_by: context.user.id })
          .select("id")
          .single();
    if (result.error)
      return {
        error: result.error.message.includes("products_org_sku")
          ? "SKU must be unique."
          : "Unable to save product.",
      };
    revalidatePath("/products");
    return { id: result.data.id };
  } catch {
    return { error: "Unable to save product." };
  }
}

export async function saveInventoryLocation(
  value: z.infer<typeof locationSchema>,
) {
  const parsed = locationSchema.safeParse(value);
  if (!parsed.success) return { error: "Enter valid location details." };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      p = parsed.data;
    if (
      !context.payload.allBranches.some((x) => x.id === p.branchId && x.active)
    )
      return { error: "Choose an active branch." };
    const row = {
      organization_id: context.organization.id,
      branch_id: p.branchId,
      name: p.name,
      code: p.code.toUpperCase(),
      is_default: p.isDefault,
      status: p.active ? "active" : "inactive",
    };
    const result = p.id
      ? await client
          .from("inventory_locations")
          .update(row)
          .eq("id", p.id)
          .eq("organization_id", context.organization.id)
          .select("id")
          .single()
      : await client
          .from("inventory_locations")
          .insert({ ...row, created_by: context.user.id })
          .select("id")
          .single();
    if (result.error)
      return {
        error: result.error.message.includes("one_default")
          ? "This branch already has a default location."
          : "Unable to save stock location.",
      };
    revalidatePath("/inventory/locations");
    return { id: result.data.id };
  } catch {
    return { error: "Unable to save stock location." };
  }
}

export async function postInventoryOperation(
  value: z.infer<typeof operationSchema>,
) {
  const parsed = operationSchema.safeParse(value);
  if (!parsed.success)
    return { error: "Enter a valid positive stock movement." };
  try {
    const context = await requireOrganizationContext(),
      client = await createClient(),
      p = parsed.data;
    if (
      (p.operationType === "opening" || p.operationType === "adjustment_in") &&
      !p.unitCost
    )
      return { error: "Enter a positive unit cost for incoming stock." };
    const source = (
      await client
        .from("inventory_locations")
        .select("branch_id")
        .eq("id", p.sourceLocationId)
        .eq("organization_id", context.organization.id)
        .single()
    ).data;
    if (!source) return { error: "Choose an accessible source location." };
    const { data, error } = await client.rpc("post_stock_operation", {
      p_operation_id: p.operationId,
      p_organization_id: context.organization.id,
      p_branch_id: source.branch_id,
      p_operation_type: p.operationType,
      p_transaction_date: p.date,
      p_product_id: p.productId,
      p_source_location_id: p.sourceLocationId,
      p_destination_location_id: p.destinationLocationId || null,
      p_quantity: p.quantity,
      p_unit_cost: p.unitCost || null,
      p_reference: p.reference || null,
      p_reason: p.reason || null,
      p_notes: p.notes || null,
    });
    if (error)
      return {
        error:
          error.message.includes("Insufficient stock") ||
          error.message.includes("inventory_cost_initialization_required")
            ? error.message
            : "Unable to post stock movement.",
      };
    revalidatePath("/inventory");
    revalidatePath("/products");
    return { data };
  } catch {
    return { error: "Unable to post stock movement." };
  }
}

export async function initializeInventoryValuation(value: {
  initializationId: string;
  productId: string;
  date: string;
  unitCost: number;
}) {
  const parsed = z
    .object({
      initializationId: uuid,
      productId: uuid,
      date: z.string().date(),
      unitCost: z.coerce.number().positive(),
    })
    .safeParse(value);
  if (!parsed.success) return { error: "Enter a valid positive unit cost." };
  try {
    const context = await requireOrganizationContext();
    const client = await createClient();
    const { data, error } = await client.rpc("initialize_inventory_valuation", {
      p_initialization_id: parsed.data.initializationId,
      p_organization_id: context.organization.id,
      p_product_id: parsed.data.productId,
      p_date: parsed.data.date,
      p_unit_cost: parsed.data.unitCost,
    });
    if (error) return { error: error.message };
    revalidatePath("/products");
    revalidatePath(`/products/${parsed.data.productId}`);
    revalidatePath("/reports/inventory-valuation");
    return { data };
  } catch {
    return { error: "Unable to initialize inventory valuation." };
  }
}
