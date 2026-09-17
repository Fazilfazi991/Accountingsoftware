export type PaymentMethod = "cash" | "bank_card" | "credit_card";
export type PaymentLeg = { method: PaymentMethod; accountId: string; amount: number };
export function paymentLegError(total: number, legs: PaymentLeg[]) {
  if (!Number.isFinite(total) || total <= 0) return "Received amount must be greater than zero.";
  if (!legs.length) return "Add at least one payment method.";
  if (legs.some((leg) => !leg.accountId || !Number.isFinite(leg.amount) || leg.amount <= 0)) return "Each payment needs an active account and an amount greater than zero.";
  const allocated = legs.reduce((sum, leg) => Math.round((sum + leg.amount) * 100) / 100, 0);
  if (Math.abs(allocated - total) > 0.005) return "Payment methods must add up to the received amount.";
  return null;
}
