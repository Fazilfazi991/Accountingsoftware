import { DemoApp } from "@/components/demo-app";
import { requireOrganizationContext } from "@/lib/organization-context";

export default async function DemoRoute({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const context = await requireOrganizationContext();
  return <DemoApp path={path} context={context.payload} />;
}
