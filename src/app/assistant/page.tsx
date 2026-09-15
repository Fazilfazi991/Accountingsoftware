import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/organization-context";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { canCreateAssistantInvoice } from "@/app/actions/assistant-invoice";
import { canCreateAssistantQuotation } from "@/app/actions/assistant-quotation";
import { canCreateAssistantCustomer } from "@/app/actions/assistant-customer";
import { ProductWorkspace } from "@/components/product-workspace";

export const metadata: Metadata = { title: "Ledgerly Assistant", description: "Ask grounded questions about your business" };
export default async function AssistantPage() {
  const context = await requireOrganizationContext();
  const providerConfigured = process.env.LEDGERLY_AI_PROVIDER === "openai-compatible" &&
    Boolean(process.env.LEDGERLY_AI_API_KEY && process.env.LEDGERLY_AI_MODEL && process.env.LEDGERLY_AI_BASE_URL);
  const [invoiceAllowed, quotationAllowed, customerAllowed] = await Promise.all([
    canCreateAssistantInvoice(), canCreateAssistantQuotation(), canCreateAssistantCustomer(),
  ]);
  return <ProductWorkspace context={context.payload} route="/assistant">
    <AssistantChat key={`${context.organization.id}:${context.branch.id}`} organization={context.organization.name} branch={context.branch.name}
      providerConfigured={providerConfigured} allowed={{ create_invoice_draft: invoiceAllowed,
        create_quotation_draft: quotationAllowed, create_customer: customerAllowed }} />
  </ProductWorkspace>;
}
