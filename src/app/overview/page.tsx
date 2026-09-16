import { DemoApp } from "@/components/demo-app";
import { requireOrganizationContext } from "@/lib/organization-context";

export const metadata = { title: "Financial Overview · FYNTA" };

export default async function OverviewPage() {
  const context = await requireOrganizationContext();
  return <DemoApp path={["overview"]} context={context.payload} />;
}
