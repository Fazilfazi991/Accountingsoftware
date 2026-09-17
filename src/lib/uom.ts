const SCALE_DIGITS = 12;
const SCALE = BigInt(10) ** BigInt(SCALE_DIGITS);

function scaled(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error("invalid_decimal");
  const [whole, fraction = ""] = raw.split(".");
  const padded = `${fraction}${"0".repeat(SCALE_DIGITS)}`.slice(0, SCALE_DIGITS);
  return BigInt(whole) * SCALE + BigInt(padded);
}

function decimal(value: bigint): string {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function divideScaled(left: bigint, right: bigint): bigint {
  if (right <= BigInt(0)) throw new Error("invalid_conversion_factor");
  return (left * SCALE + right / BigInt(2)) / right;
}

export type ProductUnits = {
  unit_id?: string | null;
  secondary_unit_id?: string | null;
  secondary_conversion_factor?: string | number | null;
  inventory_units?: { id?: string; code: string; name?: string } | null;
  secondary_unit?: { id?: string; code: string; name?: string } | null;
};

export function validProductUnits(product: ProductUnits) {
  const primary = product.inventory_units && product.unit_id
    ? [{ id: product.unit_id, code: product.inventory_units.code, name: product.inventory_units.name, factor: "1" }]
    : [];
  if (!product.secondary_unit_id || !product.secondary_unit || !product.secondary_conversion_factor) return primary;
  return [...primary, {
    id: product.secondary_unit_id,
    code: product.secondary_unit.code,
    name: product.secondary_unit.name,
    factor: String(product.secondary_conversion_factor),
  }];
}

/** Normalizes an entered transaction quantity to the product's primary unit. */
export function normalizeToPrimary(quantity: string | number, selectedUnitId: string, product: ProductUnits): string {
  const q = scaled(quantity);
  if (selectedUnitId === product.unit_id) return decimal(q);
  if (selectedUnitId !== product.secondary_unit_id || !product.secondary_conversion_factor) throw new Error("invalid_product_unit");
  return decimal(divideScaled(q, scaled(product.secondary_conversion_factor)));
}

/** Derives a secondary-unit default rate from the rate stored per primary unit. */
export function rateForUnit(primaryRate: string | number, selectedUnitId: string, product: ProductUnits): string {
  const rate = scaled(primaryRate);
  if (selectedUnitId === product.unit_id) return decimal(rate);
  if (selectedUnitId !== product.secondary_unit_id || !product.secondary_conversion_factor) throw new Error("invalid_product_unit");
  return decimal(divideScaled(rate, scaled(product.secondary_conversion_factor)));
}
