import { z } from "zod";

const uuid = z.string().uuid();

const lineSchema = z.object({
  productId: uuid,
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0),
  taxRateId: uuid.optional(),
  accountId: uuid,
  locationId: uuid.optional(),
}).refine((line) => Number(line.discount) <= Number(line.quantity) * Number(line.unitPrice), {
  path: ["discount"], message: "Discount cannot exceed the line amount.",
});

export const documentSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(["invoice", "bill"]),
  partyId: uuid,
  documentDate: z.string().date(),
  dueDate: z.string().date(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(lineSchema).min(1),
});

export function documentValidationMessage(
  kind: "invoice" | "bill",
  issues: readonly z.ZodIssue[],
): string {
  const messages = issues.map((issue) => {
    // The guided Assistant validates a nested command (`args.items`) and sometimes
    // the line array alone. Normalize both to the full-form `lines` shape.
    const nested = issue.path[0] === "args" ? issue.path.slice(1) : issue.path;
    const path = nested[0] === "items" ? ["lines", ...nested.slice(1)]
      : typeof nested[0] === "number" ? ["lines", ...nested] : nested;
    const [field, index, lineField] = path;
    if (field === "partyId" || field === "customerId") return `${kind === "invoice" ? "Customer" : "Supplier"} is required or invalid.`;
    if (field === "documentDate") return `${kind === "invoice" ? "Invoice" : "Bill"} date is required or invalid.`;
    if (field === "dueDate") return "Due date is required or invalid.";
    if (field === "reference") return "Reference is too long.";
    if (field === "notes") return "Notes are too long.";
    if (field === "lines" && typeof index !== "number") return "Add at least one valid line.";
    if (field === "lines" && typeof index === "number") {
      const prefix = `Line ${index + 1}: `;
      switch (lineField) {
        case "productId": return prefix + "Product is required or invalid.";
        case "description": return prefix + "Description is required.";
        case "quantity": return prefix + "Quantity must be greater than zero.";
        case "unitPrice": return prefix + (issue.code === "invalid_type"
          ? "Rate is required or invalid."
          : "Rate must be zero or greater.");
        case "discount": return prefix + (issue.code === "custom" ? "Discount cannot exceed the line amount." : "Discount must be zero or greater.");
        case "taxRateId": return prefix + "Tax rate is invalid.";
        case "accountId": return prefix + "Account is required or invalid.";
        case "locationId": return prefix + "Stock location is invalid.";
      }
    }
    return `Review the ${kind === "invoice" ? "invoice" : "bill"} details and line values.`;
  });
  return [...new Set(messages)].join(" ") || `Review the ${kind === "invoice" ? "invoice" : "bill"} details and line values.`;
}
