import { z } from "zod";

export const partySchema = z.object({
  id: z.string().uuid().optional(), kind: z.enum(["customer", "supplier"]),
  name: z.string().trim().min(1).max(160), trn: z.string().trim().max(30).optional(),
  email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(3650), active: z.boolean(),
});

export function customerValidationMessage(issues: readonly z.ZodIssue[]): string {
  const messages = issues.map((issue) => {
    const field = issue.path[0] === "args" ? issue.path[1] : issue.path[0];
    if (field === "name") return "Enter a customer name (up to 160 characters).";
    if (field === "email") return "Enter a valid email address or leave it blank.";
    if (field === "phone") return "Phone must be 40 characters or fewer.";
    if (field === "trn") return "TRN must be 30 characters or fewer.";
    if (field === "address") return "Billing address must be 500 characters or fewer.";
    if (field === "paymentTermsDays") return "Payment terms must be 0 to 3650 days.";
    return "Review the customer details.";
  });
  return [...new Set(messages)].join(" ") || "Review the customer details.";
}
