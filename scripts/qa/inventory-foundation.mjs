import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import "./safety.mjs";

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "LEDGERLY_QA_USER_A_EMAIL",
  "LEDGERLY_QA_USER_A_PASSWORD",
  "LEDGERLY_QA_USER_B_EMAIL",
  "LEDGERLY_QA_USER_B_PASSWORD",
];
for (const key of keys)
  if (!process.env[key]) throw new Error(`Missing ${key}`);
const make = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
const pass = (value, message) => {
  if (!value) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
};
const login = async (client, email, password) => {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
};
const a = make(),
  b = make(),
  anon = make();
await login(
  a,
  process.env.LEDGERLY_QA_USER_A_EMAIL,
  process.env.LEDGERLY_QA_USER_A_PASSWORD,
);
await login(
  b,
  process.env.LEDGERLY_QA_USER_B_EMAIL,
  process.env.LEDGERLY_QA_USER_B_PASSWORD,
);
const org = async (client, slug) => {
  const { data, error } = await client
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data.id;
};
const orgA = await org(a, "ledgerly-qa-company-a"),
  orgB = await org(b, "ledgerly-qa-company-b"),
  stamp = Date.now().toString(36),
  date = new Date().toISOString().slice(0, 10);
let result = await a.rpc("initialize_inventory_foundation", {
  p_organization_id: orgA,
});
if (result.error) throw result.error;
const { data: branches, error: branchError } = await a
  .from("branches")
  .select("id,name")
  .eq("organization_id", orgA)
  .eq("status", "active")
  .limit(1);
if (branchError || !branches?.length)
  throw branchError || new Error("No active branch");
const branch = branches[0];
const { data: unit, error: unitError } = await a
  .from("inventory_units")
  .select("id")
  .eq("organization_id", orgA)
  .eq("code", "PCS")
  .single();
if (unitError) throw unitError;
const { data: source, error: sourceError } = await a
  .from("inventory_locations")
  .select("id")
  .eq("organization_id", orgA)
  .eq("branch_id", branch.id)
  .eq("status", "active")
  .limit(1)
  .single();
if (sourceError) throw sourceError;
const { data: destination, error: destinationError } = await a
  .from("inventory_locations")
  .insert({
    organization_id: orgA,
    branch_id: branch.id,
    name: `QA Destination ${stamp}`,
    code: `Q${stamp}`.slice(0, 30).toUpperCase(),
    is_default: false,
  })
  .select("id")
  .single();
if (destinationError) throw destinationError;
const { data: product, error: productError } = await a
  .from("products")
  .insert({
    organization_id: orgA,
    kind: "product",
    name: `QA Inventory Product ${stamp}`,
    sku: `QA-INV-${stamp}`,
    unit_id: unit.id,
    track_inventory: true,
    reorder_level: 10,
  })
  .select("id")
  .single();
if (productError) throw productError;
const { data: service, error: serviceError } = await a
  .from("products")
  .insert({
    organization_id: orgA,
    kind: "service",
    name: `QA Service ${stamp}`,
    sku: `QA-SVC-${stamp}`,
    track_inventory: false,
  })
  .select("id")
  .single();
if (serviceError) throw serviceError;
const { data: inactive, error: inactiveError } = await a
  .from("products")
  .insert({
    organization_id: orgA,
    kind: "product",
    name: `QA Inactive ${stamp}`,
    sku: `QA-OFF-${stamp}`,
    unit_id: unit.id,
    track_inventory: true,
    status: "inactive",
  })
  .select("id")
  .single();
if (inactiveError) throw inactiveError;
const post = (id, type, qty, from = source.id, to = null, item = product.id) =>
  a.rpc("post_stock_operation", {
    p_operation_id: id,
    p_organization_id: orgA,
    p_branch_id: branch.id,
    p_operation_type: type,
    p_transaction_date: date,
    p_product_id: item,
    p_source_location_id: from,
    p_destination_location_id: to,
    p_quantity: qty,
    p_unit_cost: type === "opening" || type === "adjustment_in" ? 10 : null,
    p_reference: `QA-${stamp}`,
    p_reason: "Deterministic foundation QA",
    p_notes: null,
  });
const qoh = async (location = null) => {
  const { data, error } = await a.rpc("get_stock_summary", {
    p_organization_id: orgA,
    p_branch_id: null,
    p_product_id: product.id,
    p_location_id: location,
  });
  if (error) throw error;
  return data.reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
};
result = await post(randomUUID(), "opening", 100);
if (result.error) throw result.error;
pass((await qoh(source.id)) === 100, "Opening +100 produces source QOH 100");
result = await post(randomUUID(), "adjustment_in", 20);
if (result.error) throw result.error;
pass((await qoh(source.id)) === 120, "Adjustment +20 produces source QOH 120");
result = await post(randomUUID(), "adjustment_out", 30);
if (result.error) throw result.error;
pass((await qoh(source.id)) === 90, "Adjustment -30 produces source QOH 90");
result = await post(randomUUID(), "adjustment_out", 100);
pass(
  Boolean(result.error) && (await qoh(source.id)) === 90,
  "Negative-stock attempt is denied and QOH remains 90",
);
const transferId = randomUUID();
result = await post(transferId, "transfer", 25, source.id, destination.id);
if (result.error) throw result.error;
pass(
  (await qoh(source.id)) === 65 &&
    (await qoh(destination.id)) === 25 &&
    (await qoh()) === 90,
  "Transfer 25 preserves organization QOH and moves location quantities",
);
result = await post(transferId, "transfer", 25, source.id, destination.id);
if (result.error) throw result.error;
pass(
  result.data.idempotent === true && (await qoh()) === 90,
  "Repeated operation id is idempotent",
);
pass(
  Boolean(
    (await post(randomUUID(), "opening", 1, source.id, null, service.id)).error,
  ),
  "Services are rejected from stock posting",
);
pass(
  Boolean(
    (await post(randomUUID(), "opening", 1, source.id, null, inactive.id))
      .error,
  ),
  "Inactive products are rejected from stock posting",
);
pass(
  Boolean(
    (
      await a.rpc("post_stock_operation", {
        p_operation_id: randomUUID(),
        p_organization_id: orgB,
        p_branch_id: branch.id,
        p_operation_type: "opening",
        p_transaction_date: date,
        p_product_id: product.id,
        p_source_location_id: source.id,
        p_destination_location_id: null,
        p_quantity: 1,
        p_unit_cost: 10,
        p_reference: null,
        p_reason: null,
        p_notes: null,
      })
    ).error,
  ),
  "Cross-tenant posting is denied",
);
pass(
  Boolean(
    (
      await anon.rpc("get_stock_summary", {
        p_organization_id: orgA,
        p_branch_id: null,
        p_product_id: null,
        p_location_id: null,
      })
    ).error,
  ),
  "Anonymous inventory reporting is denied",
);
pass(
  Boolean((await anon.from("stock_movements").select("id").limit(1)).error),
  "Anonymous movement reads are denied",
);
pass(
  Boolean(
    (
      await a
        .from("stock_movements")
        .insert({
          organization_id: orgA,
          branch_id: branch.id,
          location_id: source.id,
          product_id: product.id,
          transaction_date: date,
          movement_type: "opening",
          signed_quantity: 999,
          source_document_type: "forged",
          source_document_id: randomUUID(),
          created_by: (await a.auth.getUser()).data.user.id,
        })
    ).error,
  ),
  "Direct movement inserts are denied",
);
const { data: ownRows, error: ownError } = await a
  .from("stock_movements")
  .select("id,organization_id")
  .eq("product_id", product.id);
if (ownError) throw ownError;
pass(
  ownRows.length === 5 && ownRows.every((row) => row.organization_id === orgA),
  "Movement ledger has deterministic row count and tenant ownership",
);
const crossRead = await b
  .from("stock_movements")
  .select("id")
  .eq("product_id", product.id);
pass(
  !crossRead.error && crossRead.data.length === 0,
  "Cross-tenant movement reads return no rows",
);
const { data: raceProduct, error: raceProductError } = await a
  .from("products")
  .insert({
    organization_id: orgA,
    kind: "product",
    name: `QA Concurrency ${stamp}`,
    sku: `QA-RACE-${stamp}`,
    unit_id: unit.id,
    track_inventory: true,
  })
  .select("id")
  .single();
if (raceProductError) throw raceProductError;
result = await post(
  randomUUID(),
  "opening",
  50,
  source.id,
  null,
  raceProduct.id,
);
if (result.error) throw result.error;
const racePost = (id) =>
  post(id, "adjustment_out", 40, source.id, null, raceProduct.id);
const raced = await Promise.all([
  racePost(randomUUID()),
  racePost(randomUUID()),
]);
const raceQoh = async () => {
  const { data, error } = await a.rpc("get_stock_summary", {
    p_organization_id: orgA,
    p_branch_id: null,
    p_product_id: raceProduct.id,
    p_location_id: source.id,
  });
  if (error) throw error;
  return data.reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
};
pass(
  raced.filter((x) => !x.error).length === 1 &&
    raced.filter((x) => x.error).length === 1 &&
    (await raceQoh()) === 10,
  "Concurrent stock-outs cannot double-consume available quantity",
);
const movementId = ownRows[0].id;
const updateAttempt = await a
  .from("stock_movements")
  .update({ notes: "forged" })
  .eq("id", movementId)
  .select("id");
const afterUpdate = await a
  .from("stock_movements")
  .select("id,notes")
  .eq("id", movementId)
  .single();
pass(
  (Boolean(updateAttempt.error) || updateAttempt.data.length === 0) &&
    !afterUpdate.error &&
    afterUpdate.data.notes !== "forged",
  "Direct movement updates are denied",
);
const deleteAttempt = await a
  .from("stock_movements")
  .delete()
  .eq("id", movementId)
  .select("id");
const afterDelete = await a
  .from("stock_movements")
  .select("id")
  .eq("id", movementId)
  .single();
pass(
  (Boolean(deleteAttempt.error) || deleteAttempt.data.length === 0) &&
    !afterDelete.error,
  "Direct movement deletes are denied",
);
console.log(
  `CERTIFIED inventory product ${product.id}: source 65 PCS, destination 25 PCS, organization 90 PCS`,
);
