import type { BusinessDocumentData } from "@/app/actions/business-documents";

type BusinessDocumentChoices = Pick<BusinessDocumentData, "products" | "accounts" | "locations">;

export type BusinessDocumentKind = "invoice" | "bill";

export type BusinessDocumentLine = {
  productId: string;
  description: string;
  quantity: number;
  unitId?: string;
  unitPrice: number;
  discount: number;
  taxRateId: string;
  accountId: string;
  locationId: string;
  sourceType?: "quotation" | "delivery_note";
  sourceDocumentId?: string;
  sourceLineId?: string;
  remaining?: number;
  sourceDiscountPerUnit?: number;
};

function defaultAccount(data: BusinessDocumentChoices, kind: BusinessDocumentKind) {
  if (kind === "bill") return "";
  return (
    data.accounts.find((x) => x.system_key === "sales_revenue")?.id ||
    data.accounts.find((x) => x.account_type === "income")?.id ||
    ""
  );
}

export function savedLineAccount(
  savedAccountId: string | null | undefined,
  data: BusinessDocumentChoices,
  kind: BusinessDocumentKind,
) {
  return savedAccountId || defaultAccount(data, kind);
}

export function newLine(data: BusinessDocumentChoices, kind: BusinessDocumentKind): BusinessDocumentLine {
  const p = data.products[0],
    tracked = p?.kind === "product" && p.track_inventory;
  return {
    productId: p?.id || "",
    description: p?.name || "",
    quantity: 1,
    unitId: p?.unit_id || undefined,
    unitPrice:
      Number(kind === "invoice" ? p?.sales_price : p?.purchase_price) || 0,
    discount: 0,
    taxRateId: p?.tax_rate_id || "",
    accountId: defaultAccount(data, kind),
    locationId: tracked
      ? data.locations.find((x) => x.is_default)?.id ||
        data.locations[0]?.id ||
        ""
      : "",
  };
}

export function productSelectionPatch(
  data: BusinessDocumentChoices,
  kind: BusinessDocumentKind,
  productId: string,
): Partial<BusinessDocumentLine> {
  const p = data.products.find((x) => x.id === productId),
    tracked = p?.kind === "product" && p.track_inventory,
    location = tracked
      ? data.locations.find((x) => x.is_default)?.id ||
        data.locations[0]?.id ||
        ""
      : "";
  return {
    productId,
    description: p?.name || "",
    unitId: p?.unit_id || undefined,
    unitPrice:
      Number(kind === "invoice" ? p?.sales_price : p?.purchase_price) || 0,
    taxRateId: p?.tax_rate_id || "",
    locationId: location,
  };
}
