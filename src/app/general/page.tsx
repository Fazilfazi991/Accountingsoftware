import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/organization-context";
import { AiWorkspaceShell } from "@/components/product-workspace";
import { GeneralChat } from "@/components/general-chat";

export const metadata: Metadata = { title: "Ask General · Ledgerly", description: "Ask questions and work through everyday tasks" };

export default async function GeneralPage() {
  const context = await requireOrganizationContext();
  return <AiWorkspaceShell context={context.payload} route="/general">
    <GeneralChat />
  </AiWorkspaceShell>;
}
