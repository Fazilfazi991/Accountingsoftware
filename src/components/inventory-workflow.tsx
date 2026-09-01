"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getInventoryData,
  initializeInventoryValuation,
  postInventoryOperation,
  saveInventoryLocation,
  saveInventoryProduct,
  type InventoryData,
} from "@/app/actions/inventory";

type Mode =
  | "products"
  | "product-new"
  | "product-detail"
  | "locations"
  | "units"
  | "opening"
  | "adjustment"
  | "transfer"
  | "summary"
  | "movements"
  | "valuation"
  | "cogs";
const qty = (v: unknown) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 4 }).format(
    Number(v || 0),
  );
const money = (v: unknown) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    Number(v || 0),
  );
const today = new Date().toISOString().slice(0, 10);
export function InventoryWorkflow({ mode, id }: { mode: Mode; id?: string }) {
  const [data, setData] = useState<InventoryData | null>(null),
    [error, setError] = useState(""),
    [filters, setFilters] = useState<Filters>({
      branchId: "",
      productId: "",
      locationId: "",
      from: "",
      to: "",
      movementType: "",
    });
  const load = useCallback(async () => {
    const result = await getInventoryData(filters);
    if ("error" in result) setError(result.error);
    else {
      setData(result);
      setError("");
    }
  }, [filters]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return (
      <>
        <Heading title="Inventory" subtitle="Loading real stock records…" />
        {error && <p className="error">{error}</p>}
      </>
    );
  const refresh = async () => {
    await load();
  };
  const headings: Record<Mode, [string, string]> = {
    products: [
      "Products & services",
      "Canonical item master for sales, purchases, and inventory.",
    ],
    "product-new": [
      "New product or service",
      "Create a real organization-scoped item.",
    ],
    "product-detail": [
      "Product detail",
      "Stock by location and recent movement history.",
    ],
    locations: ["Stock locations", "Branch-scoped physical stock locations."],
    units: ["Units", "Inventory units with no conversion in V1."],
    opening: [
      "Stock opening",
      "Post initial quantity and value to Inventory and owner capital.",
    ],
    adjustment: [
      "Stock adjustment",
      "Record a controlled quantity increase or decrease.",
    ],
    transfer: ["Stock transfer", "Move quantity atomically between locations."],
    summary: [
      "Stock summary",
      "Live quantity on hand derived from immutable movements.",
    ],
    movements: [
      "Stock movement report",
      "Chronological quantity and immutable cost ledger.",
    ],
    valuation: [
      "Inventory valuation",
      "Current weighted-average inventory carrying value.",
    ],
    cogs: [
      "Cost of goods sold",
      "Issued cost and physical sales-return reversals.",
    ],
  };
  const h = headings[mode];
  return (
    <>
      <Heading
        title={h[0]}
        subtitle={h[1]}
        action={mode === "products" ? ["New item", "/products/new"] : undefined}
      />
      {error && <p className="error">{error}</p>}
      {mode === "products" ? (
        <Products data={data} />
      ) : mode === "product-new" ? (
        <ProductForm data={data} />
      ) : mode === "product-detail" ? (
        <ProductDetail data={data} id={id!} />
      ) : mode === "locations" ? (
        <Locations data={data} refresh={refresh} />
      ) : mode === "units" ? (
        <Units data={data} />
      ) : mode === "opening" ? (
        <Operation data={data} kind="opening" refresh={refresh} />
      ) : mode === "adjustment" ? (
        <Operation data={data} kind="adjustment" refresh={refresh} />
      ) : mode === "transfer" ? (
        <Operation data={data} kind="transfer" refresh={refresh} />
      ) : mode === "summary" ? (
        <Summary data={data} filters={filters} setFilters={setFilters} />
      ) : mode === "movements" ? (
        <Movements data={data} filters={filters} setFilters={setFilters} />
      ) : mode === "valuation" ? (
        <Valuation data={data} filters={filters} setFilters={setFilters} />
      ) : (
        <Cogs data={data} filters={filters} setFilters={setFilters} />
      )}
    </>
  );
}
function Heading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: [string, string];
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && (
        <Link className="button" href={action[1]}>
          + {action[0]}
        </Link>
      )}
    </div>
  );
}
function Products({ data }: { data: InventoryData }) {
  const total = (id: string) =>
    data.summary
      .filter((x) => x.product_id === id)
      .reduce((s, x) => s + Number(x.quantity_on_hand), 0);
  const value = (id: string) => data.valuation.find((x) => x.product_id === id);
  return (
    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Type</th>
              <th>Unit</th>
              <th>Inventory</th>
              <th>Sales price</th>
              <th>Purchase default</th>
              <th>VAT</th>
              <th>Stock</th>
              <th>Average cost</th>
              <th>Inventory value</th>
              <th>Reorder level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link className="record-link" href={`/products/${p.id}`}>
                    {p.name}
                  </Link>
                </td>
                <td>{p.sku || "—"}</td>
                <td>{p.kind === "service" ? "Service" : "Product"}</td>
                <td>{p.inventory_units?.code || "—"}</td>
                <td>
                  {p.kind === "service"
                    ? "N/A"
                    : p.track_inventory
                      ? "Tracked"
                      : "Not tracked"}
                </td>
                <td>{money(p.sales_price)}</td>
                <td>{money(p.purchase_price)}</td>
                <td>
                  {p.tax_rates
                    ? `${p.tax_rates.code} · ${p.tax_rates.rate_percent}%`
                    : "No VAT"}
                </td>
                <td>
                  {p.kind === "service"
                    ? "N/A"
                    : p.track_inventory
                      ? qty(total(p.id))
                      : "Not tracked"}
                </td>
                <td>{p.kind === "service" ? "N/A" : qty(p.reorder_level)}</td>
                <td>
                  {p.track_inventory
                    ? money(value(p.id)?.average_unit_cost)
                    : "N/A"}
                </td>
                <td>
                  {p.track_inventory
                    ? money(value(p.id)?.inventory_value)
                    : "N/A"}
                </td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.products.length && (
        <p className="empty">No real products or services yet.</p>
      )}
    </section>
  );
}
function ProductForm({ data }: { data: InventoryData }) {
  const router = useRouter(),
    [kind, setKind] = useState<"product" | "service">("product"),
    [tracked, setTracked] = useState(true),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await saveInventoryProduct({
      kind,
      name: String(f.get("name")),
      sku: String(f.get("sku")),
      category: String(f.get("category")),
      unitId: tracked && kind === "product" ? String(f.get("unit")) : undefined,
      salesPrice: Number(f.get("salesPrice")),
      purchasePrice: Number(f.get("purchasePrice")),
      taxRateId: String(f.get("taxRate") || "") || undefined,
      trackInventory: tracked && kind === "product",
      reorderLevel: Number(f.get("reorder")),
      active: true,
    });
    if ("error" in r) setMessage(r.error ?? "Unable to save product.");
    else router.push(`/products/${r.id}`);
  }
  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Type
          <select
            value={kind}
            onChange={(e) => {
              const v = e.target.value as "product" | "service";
              setKind(v);
              if (v === "service") setTracked(false);
            }}
          >
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
        </label>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          SKU
          <input name="sku" />
        </label>
        <label>
          Category
          <input name="category" />
        </label>
        <label>
          Unit
          <select name="unit" disabled={!tracked}>
            {data.units
              .filter((x) => x.status === "active")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Track inventory
          <input
            type="checkbox"
            checked={tracked}
            disabled={kind === "service"}
            onChange={(e) => setTracked(e.target.checked)}
          />
        </label>
        <label>
          Sales price
          <input
            name="salesPrice"
            type="number"
            min="0"
            step="0.0001"
            defaultValue="0"
          />
        </label>
        <label>
          Purchase price
          <input
            name="purchasePrice"
            type="number"
            min="0"
            step="0.0001"
            defaultValue="0"
          />
        </label>
        <label>
          VAT rate
          <select name="taxRate">
            <option value="">No VAT</option>
            {data.taxRates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.rate_percent}%
              </option>
            ))}
          </select>
        </label>
        <label>
          Reorder level
          <input
            name="reorder"
            type="number"
            min="0"
            step="0.0001"
            defaultValue="0"
            disabled={!tracked}
          />
        </label>
      </div>
      {message && <p className="error">{message}</p>}
      <div className="form-actions">
        <Link className="button secondary" href="/products">
          Cancel
        </Link>
        <button className="button">Save item</button>
      </div>
    </form>
  );
}
function ProductDetail({ data, id }: { data: InventoryData; id: string }) {
  const [valuationMessage, setValuationMessage] = useState("");
  const p = data.products.find((x) => x.id === id);
  if (!p) return <section className="panel empty">Product not found.</section>;
  const stock = data.summary.filter((x) => x.product_id === id),
    movements = data.movements.filter((x) => x.product_id === id).slice(0, 20),
    total = stock.reduce((s, x) => s + Number(x.quantity_on_hand), 0),
    valuation = data.valuation.find((x) => x.product_id === id);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{p.name}</h2>
            <p>
              {p.sku || "No SKU"} · {p.kind} ·{" "}
              {p.inventory_units?.code || "No unit"}
            </p>
          </div>
          <strong>
            {p.kind === "service"
              ? "Stock N/A"
              : p.track_inventory
                ? `${qty(total)} ${p.inventory_units?.code}`
                : "Inventory not tracked"}
          </strong>
        </div>
        {valuation && (
          <div className="summary-strip">
            <span>
              Average cost <strong>{money(valuation.average_unit_cost)}</strong>
            </span>
            <span>
              Inventory value{" "}
              <strong>{money(valuation.inventory_value)}</strong>
            </span>
            <span>
              Valuation{" "}
              <strong>
                {valuation.valuation_status === "costed"
                  ? "Costed"
                  : "Required"}
              </strong>
            </span>
          </div>
        )}
      </section>
      {p.kind === "product" && p.track_inventory && (
        <>
          {valuation?.valuation_status === "valuation_required" &&
            Number(valuation.quantity_on_hand) > 0 && (
              <form
                className="panel toolbar"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const result = await initializeInventoryValuation({
                    initializationId: crypto.randomUUID(),
                    productId: id,
                    date: String(form.get("date")),
                    unitCost: Number(form.get("unitCost")),
                  });
                  setValuationMessage(
                    "error" in result
                      ? result.error || "Unable to initialize valuation."
                      : "Valuation initialized. Refresh to view the result.",
                  );
                }}
              >
                <strong>Legacy stock needs valuation</strong>
                <input
                  aria-label="Valuation date"
                  name="date"
                  type="date"
                  defaultValue={today}
                  required
                />
                <input
                  aria-label="Unit cost"
                  name="unitCost"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  placeholder="Unit cost (AED)"
                  required
                />
                <button className="button">Initialize valuation</button>
                {valuationMessage && (
                  <p
                    className={
                      valuationMessage.includes("initialized")
                        ? "success"
                        : "error"
                    }
                  >
                    {valuationMessage}
                  </p>
                )}
              </form>
            )}
          <section className="panel">
            <h2>Quantity by location</h2>
            <StockTable rows={stock} />
          </section>
          <section className="panel">
            <h2>Recent movements</h2>
            <MovementTable rows={movements} />
          </section>
        </>
      )}
    </>
  );
}
function Locations({
  data,
  refresh,
}: {
  data: InventoryData;
  refresh: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      r = await saveInventoryLocation({
        branchId: String(f.get("branch")),
        name: String(f.get("name")),
        code: String(f.get("code")),
        isDefault: f.get("default") === "on",
        active: true,
      });
    setMessage(
      "error" in r
        ? (r.error ?? "Unable to save location.")
        : "Location saved.",
    );
    if (!("error" in r)) {
      e.currentTarget.reset();
      await refresh();
    }
  }
  return (
    <>
      <form className="panel toolbar" onSubmit={submit}>
        <select name="branch">
          {data.branches
            .filter((x) => x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
        <input name="name" placeholder="Location name" required />
        <input name="code" placeholder="Code" required />
        <label>
          <input name="default" type="checkbox" /> Default
        </label>
        <button className="button">Add location</button>
        {message && (
          <p className={message.includes("saved") ? "success" : "error"}>
            {message}
          </p>
        )}
      </form>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Code</th>
                <th>Branch</th>
                <th>Default</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.locations.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.code}</td>
                  <td>{x.branches?.name}</td>
                  <td>{x.is_default ? "Yes" : "No"}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Units({ data }: { data: InventoryData }) {
  return (
    <section className="panel">
      <p>V1 quantities use one unit per item; conversions are deferred.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((x) => (
              <tr key={x.id}>
                <td>{x.code}</td>
                <td>{x.name}</td>
                <td>{x.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Operation({
  data,
  kind,
  refresh,
}: {
  data: InventoryData;
  kind: "opening" | "adjustment" | "transfer";
  refresh: () => Promise<void>;
}) {
  const inventory = data.products.filter(
      (x) => x.kind === "product" && x.track_inventory && x.status === "active",
    ),
    locations = data.locations.filter((x) => x.status === "active"),
    [direction, setDirection] = useState("adjustment_in"),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      r = await postInventoryOperation({
        operationId: crypto.randomUUID(),
        operationType:
          kind === "adjustment"
            ? (direction as "adjustment_in" | "adjustment_out")
            : kind,
        date: String(f.get("date")),
        productId: String(f.get("product")),
        sourceLocationId: String(f.get("source")),
        destinationLocationId:
          kind === "transfer" ? String(f.get("destination")) : undefined,
        quantity: Number(f.get("quantity")),
        unitCost:
          kind === "opening" ||
          (kind === "adjustment" && direction === "adjustment_in")
            ? Number(f.get("unitCost"))
            : undefined,
        reference: String(f.get("reference")),
        reason: String(f.get("reason")),
        notes: String(f.get("notes")),
      });
    setMessage(
      "error" in r
        ? (r.error ?? "Unable to post movement.")
        : "Stock movement posted.",
    );
    if (!("error" in r)) {
      e.currentTarget.reset();
      await refresh();
    }
  }
  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Date
          <input name="date" type="date" defaultValue={today} required />
        </label>
        <label>
          Product
          <select name="product" required>
            {inventory.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} {x.sku ? `(${x.sku})` : ""}
              </option>
            ))}
          </select>
        </label>
        {kind === "adjustment" && (
          <label>
            Direction
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="adjustment_in">Increase</option>
              <option value="adjustment_out">Decrease</option>
            </select>
          </label>
        )}
        <label>
          {kind === "transfer" ? "Source location" : "Location"}
          <select name="source" required>
            {locations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.branches?.name}
              </option>
            ))}
          </select>
        </label>
        {kind === "transfer" && (
          <label>
            Destination location
            <select name="destination" required>
              {locations.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.branches?.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Quantity
          <input
            name="quantity"
            type="number"
            min="0.0001"
            step="0.0001"
            required
          />
        </label>
        {(kind === "opening" ||
          (kind === "adjustment" && direction === "adjustment_in")) && (
          <label>
            Unit cost (AED)
            <input
              name="unitCost"
              type="number"
              min="0.000001"
              step="0.000001"
              required
            />
          </label>
        )}
        <label>
          Reference
          <input name="reference" />
        </label>
        <label>
          Reason
          <input name="reason" required={kind === "adjustment"} />
        </label>
      </div>
      <label className="wide-label">
        Notes
        <textarea name="notes" />
      </label>
      {message && (
        <p className={message.includes("posted") ? "success" : "error"}>
          {message}
        </p>
      )}
      <div className="form-actions">
        <button
          className="button"
          disabled={!inventory.length || !locations.length}
        >
          Post {kind}
        </button>
      </div>
    </form>
  );
}
type Filters = {
  branchId: string;
  productId: string;
  locationId: string;
  from: string;
  to: string;
  movementType: string;
};
function FilterBar({
  data,
  filters,
  setFilters,
  dateFilters = false,
  movementTypeFilter = false,
  showBranch = true,
  showLocation = true,
}: {
  data: InventoryData;
  filters: Filters;
  setFilters: (x: Filters) => void;
  dateFilters?: boolean;
  movementTypeFilter?: boolean;
  showBranch?: boolean;
  showLocation?: boolean;
}) {
  return (
    <section className="panel toolbar report-toolbar">
      {showBranch ? (
        <select
          aria-label="Branch"
          value={filters.branchId}
          onChange={(e) => setFilters({ ...filters, branchId: e.target.value })}
        >
          <option value="">All branches</option>
          {data.branches.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      ) : null}
      {dateFilters ? (
        <>
          <input
            aria-label="From date"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
          <input
            aria-label="To date"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
          {movementTypeFilter ? (
            <select
              aria-label="Movement type"
              value={filters.movementType}
              onChange={(e) =>
                setFilters({ ...filters, movementType: e.target.value })
              }
            >
              <option value="">All movement types</option>
              {[
                "opening",
                "adjustment_in",
                "adjustment_out",
                "transfer_in",
                "transfer_out",
                "purchase",
                "purchase_return",
                "sale",
                "sales_return",
              ].map((x) => (
                <option key={x} value={x}>
                  {x.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
      {showLocation ? (
        <select
          aria-label="Product"
          value={filters.productId}
          onChange={(e) =>
            setFilters({ ...filters, productId: e.target.value })
          }
        >
          <option value="">All products</option>
          {data.products
            .filter((x) => x.kind === "product")
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      ) : null}
      <select
        aria-label="Location"
        value={filters.locationId}
        onChange={(e) => setFilters({ ...filters, locationId: e.target.value })}
      >
        <option value="">All locations</option>
        {data.locations.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </section>
  );
}
function Summary({
  data,
  filters,
  setFilters,
}: {
  data: InventoryData;
  filters: Filters;
  setFilters: (x: Filters) => void;
}) {
  return (
    <>
      <FilterBar {...{ data, filters, setFilters }} />
      <section className="panel">
        <StockTable rows={data.summary} />
      </section>
    </>
  );
}
function StockTable({ rows }: { rows: any[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Location</th>
            <th>Unit</th>
            <th>Quantity on hand</th>
            <th>Reorder level</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={`${x.product_id}-${x.location_id}`}>
              <td>
                <Link
                  className="record-link"
                  href={`/products/${x.product_id}`}
                >
                  {x.product_name}
                </Link>
              </td>
              <td>{x.sku || "—"}</td>
              <td>{x.location_name}</td>
              <td>{x.unit_code}</td>
              <td>{qty(x.quantity_on_hand)}</td>
              <td>{qty(x.reorder_level)}</td>
              <td>
                {x.low_stock ? (
                  <span className="badge b-overdue">Low</span>
                ) : (
                  <span className="badge b-posted">OK</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Movements({
  data,
  filters,
  setFilters,
}: {
  data: InventoryData;
  filters: Filters;
  setFilters: (x: Filters) => void;
}) {
  return (
    <>
      <FilterBar
        {...{ data, filters, setFilters }}
        dateFilters
        movementTypeFilter
      />
      <section className="panel">
        <MovementTable rows={data.movements} />
      </section>
    </>
  );
}
function MovementTable({ rows }: { rows: any[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Product</th>
            <th>Location</th>
            <th>Type</th>
            <th>Document</th>
            <th>Reference</th>
            <th>In</th>
            <th>Out</th>
            <th>Running qty</th>
            <th>Unit cost</th>
            <th>Movement value</th>
            <th>Cost journal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const n = Number(x.signed_quantity);
            const documentRoot =
              x.source_document_type === "sales_invoice"
                ? "/sales/invoices"
                : x.source_document_type === "purchase_bill"
                  ? "/purchases/bills"
                  : x.source_document_type === "sales_credit_note"
                    ? "/sales/credit-notes"
                    : x.source_document_type === "purchase_debit_note"
                  ? "/purchases/debit-notes"
                      : x.source_document_type === "delivery_note"
                        ? "/sales/delivery-notes"
                        : x.source_document_type === "stock_operation"
                          ? x.movement_type === "opening"
                            ? "/inventory/opening"
                            : "/inventory/adjustments"
                      : null;
            return (
              <tr key={x.id}>
                <td>{x.transaction_date}</td>
                <td>
                  <Link
                    className="record-link"
                    href={`/products/${x.product_id}`}
                  >
                    {x.product_name}
                  </Link>
                </td>
                <td>{x.location_name}</td>
                <td>{String(x.movement_type).replaceAll("_", " ")}</td>
                <td>
                  {documentRoot && x.source_document_id ? (
                    <Link
                      className="record-link"
                      href={x.source_document_type === "stock_operation" ? `${documentRoot}?operation=${x.source_document_id}` : `${documentRoot}/${x.source_document_id}`}
                    >
                      {x.source_document_number || x.reference || "View source"}
                    </Link>
                  ) : (
                    x.source_document_number || "—"
                  )}
                </td>
                <td>{x.reference || "—"}</td>
                <td>{n > 0 ? qty(n) : "—"}</td>
                <td>{n < 0 ? qty(-n) : "—"}</td>
                <td>{qty(x.running_quantity)}</td>
                <td>
                  {x.unit_cost == null
                    ? "Valuation required"
                    : money(x.unit_cost)}
                </td>
                <td>
                  {x.movement_value == null
                    ? "—"
                    : money(Math.abs(Number(x.movement_value)))}
                </td>
                <td>
                  {x.journal_entry_id ? (
                    <Link
                      className="record-link"
                      href={`/accounting/journals/${x.journal_entry_id}`}
                    >
                      View journal
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Valuation({
  data,
  filters,
  setFilters,
}: {
  data: InventoryData;
  filters: Filters;
  setFilters: (x: Filters) => void;
}) {
  const total = data.valuation.reduce(
    (sum, row) => sum + Number(row.inventory_value),
    0,
  );
  return (
    <>
      <FilterBar
        {...{ data, filters, setFilters }}
        showBranch={false}
        showLocation={false}
      />
      <section className="panel">
        <div className="summary-strip">
          <span>
            Total inventory value <strong>{money(total)}</strong>
          </span>
          <span>
            Products <strong>{data.valuation.length}</strong>
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Average cost</th>
                <th>Inventory value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.valuation.map((x) => (
                <tr key={x.product_id}>
                  <td>
                    <Link
                      className="record-link"
                      href={`/products/${x.product_id}`}
                    >
                      {x.product_name}
                    </Link>
                  </td>
                  <td>{x.sku || "—"}</td>
                  <td>{qty(x.quantity_on_hand)}</td>
                  <td>{money(x.average_unit_cost)}</td>
                  <td>{money(x.inventory_value)}</td>
                  <td>
                    {x.valuation_status === "costed" ? (
                      <span className="badge b-posted">Costed</span>
                    ) : (
                      <span className="badge b-overdue">
                        Valuation required
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Cogs({
  data,
  filters,
  setFilters,
}: {
  data: InventoryData;
  filters: Filters;
  setFilters: (x: Filters) => void;
}) {
  const total = data.cogs.reduce(
    (sum, row) => sum + Number(row.cogs_amount),
    0,
  );
  return (
    <>
      <FilterBar
        {...{ data, filters, setFilters }}
        dateFilters
        showBranch={false}
        showLocation={false}
      />
      <section className="panel">
        <div className="summary-strip">
          <span>
            Net COGS <strong>{money(total)}</strong>
          </span>
          <span>
            Cost events <strong>{data.cogs.length}</strong>
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Quantity</th>
                <th>Unit cost</th>
                <th>COGS</th>
                <th>Journal</th>
              </tr>
            </thead>
            <tbody>
              {data.cogs.map((x) => (
                <tr key={x.id}>
                  <td>{x.event_date}</td>
                  <td>{x.product_name}</td>
                  <td>{String(x.event_type).replaceAll("_", " ")}</td>
                  <td>{x.reference || "—"}</td>
                  <td>{qty(x.quantity)}</td>
                  <td>{money(x.unit_cost)}</td>
                  <td>{money(x.cogs_amount)}</td>
                  <td>
                    {x.journal_entry_id ? (
                      <Link
                        className="record-link"
                        href={`/accounting/journals/${x.journal_entry_id}`}
                      >
                        {x.journal_number || "View journal"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
