import { DemoApp } from "@/components/demo-app";
import { requireOrganizationContext } from "@/lib/organization-context";

export default async function Home() {
  const context = await requireOrganizationContext();
  return <DemoApp path={[]} context={context.payload} />;
}
