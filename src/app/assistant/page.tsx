import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/organization-context";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { canCreateAssistantInvoice } from "@/app/actions/assistant-invoice";
import { canCreateAssistantQuotation } from "@/app/actions/assistant-quotation";
import { canCreateAssistantCustomer } from "@/app/actions/assistant-customer";
import { AiWorkspaceShell } from "@/components/product-workspace";

export const metadata: Metadata = { title: "Ledgerly Assistant", description: "Ask grounded questions about your business" };
export default async function AssistantPage() {
  const context = await requireOrganizationContext();
  const [invoiceAllowed, quotationAllowed, customerAllowed] = await Promise.all([
    canCreateAssistantInvoice(), canCreateAssistantQuotation(), canCreateAssistantCustomer(),
  ]);
  return <AiWorkspaceShell context={context.payload} route="/assistant">
    <AssistantChat key={`${context.organization.id}:${context.branch.id}`} allowed={{ create_invoice_draft: invoiceAllowed,
        create_quotation_draft: quotationAllowed, create_customer: customerAllowed }} />
  </AiWorkspaceShell>;
}
