import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/organization-context";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { canCreateAssistantInvoice } from "@/app/actions/assistant-invoice";
import { ProductWorkspace } from "@/components/product-workspace";

export const metadata: Metadata = { title: "Ledgerly Assistant", description: "Ask grounded questions about your business" };
export default async function AssistantPage() {
  const context = await requireOrganizationContext();
  const providerConfigured = process.env.LEDGERLY_AI_PROVIDER === "openai-compatible" &&
    Boolean(process.env.LEDGERLY_AI_API_KEY && process.env.LEDGERLY_AI_MODEL && process.env.LEDGERLY_AI_BASE_URL);
  const invoiceAllowed = await canCreateAssistantInvoice();
  return <ProductWorkspace context={context.payload} route="/assistant">
    <AssistantChat key={`${context.organization.id}:${context.branch.id}`} organization={context.organization.name} branch={context.branch.name}
      providerConfigured={providerConfigured} invoiceAllowed={invoiceAllowed} />
  </ProductWorkspace>;
}
