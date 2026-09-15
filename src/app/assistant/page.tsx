import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/organization-context";
import { AssistantChat } from "@/components/assistant/assistant-chat";

export const metadata: Metadata = { title: "Ledgerly Assistant", description: "Ask grounded questions about your business" };
export default async function AssistantPage() {
  const context = await requireOrganizationContext();
  return <AssistantChat key={`${context.organization.id}:${context.branch.id}`} organization={context.organization.name} branch={context.branch.name} />;
}
