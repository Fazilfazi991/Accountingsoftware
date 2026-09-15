import { z } from "zod";

const uuid = z.string().uuid();
export const operationalLineSchema = z.object({
  productId: uuid, description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0), taxRateId: uuid.optional(), accountId: uuid,
});
export const operationalDocumentSchema = z.object({
  id: uuid.optional(), kind: z.enum(["quotation", "delivery_note"]),
  customerId: uuid, date: z.string().date(), expiry: z.string().date().optional(),
  reference: z.string().trim().max(120).optional(), notes: z.string().trim().max(500).optional(),
  lines: z.array(operationalLineSchema).min(1),
  allocations: z.array(z.object({
    sourceType: z.enum(["quotation", "delivery_note"]),
    sourceDocumentId: uuid, sourceLineId: uuid, quantity: z.coerce.number().positive(),
  })).default([]),
});

export function quotationValidationMessage(issues: readonly z.ZodIssue[]): string {
  const messages = issues.map((issue) => {
    const path = issue.path[0] === "args" ? issue.path.slice(1) : issue.path;
    const [field, index, lineField] = path;
    if (field === "customerId") return "Choose an active customer.";
    if (field === "date") return "Quotation date is required or invalid.";
    if (field === "expiry") return "Valid-until date is required or invalid.";
    if (field === "reference") return "Reference is too long.";
    if (field === "notes") return "Notes are too long.";
    if (field === "lines" && typeof index === "number") {
      const prefix = `Item ${index + 1}: `;
      if (lineField === "productId") return prefix + "Choose a product or service.";
      if (lineField === "description") return prefix + "Enter a description.";
      if (lineField === "quantity") return prefix + "Quantity must be greater than zero.";
      if (lineField === "unitPrice") return prefix + "Rate must be zero or greater.";
      if (lineField === "discount") return prefix + "Discount must be zero or greater.";
      if (lineField === "taxRateId") return prefix + "Choose a valid sales tax rate.";
      if (lineField === "accountId") return prefix + "Choose an income account.";
    }
    if (field === "lines") return "Add at least one valid item or service.";
    return "Review the quotation details and item values.";
  });
  return [...new Set(messages)].join(" ") || "Review the quotation details and item values.";
}
