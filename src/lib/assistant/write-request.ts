import { z } from "zod";

export const requestKeySchema = z.string().uuid();

/** A key identifies one confirmed logical write, not one network attempt. */
export function assistantWriteError(message: string): string {
  if (message.includes("assistant_write_payload_mismatch"))
    return "This request was already used with different details. Start a new action to save changed details.";
  if (message.includes("assistant_write_scope_mismatch"))
    return "This request belongs to another user or branch. Start a new action in the current branch.";
  if (message.includes("assistant_customer_name_exists"))
    return "That exact customer name already exists. Edit the name or use the existing customer.";
  if (message.includes("not_authorized")) return "You no longer have permission to perform this action.";
  return message;
}
