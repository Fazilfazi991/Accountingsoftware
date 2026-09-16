"use client";

import type { ReactNode } from "react";
import { AppShell, OrganizationProvider } from "@/components/app-shell";
import { primaryNavigation } from "@/components/primary-navigation";
import type { OrganizationContextPayload } from "@/lib/organization-context";

export function ProductWorkspace({ context, route, children, topbar = null }: {
  context: OrganizationContextPayload;
  route: "/" | "/today" | "/assistant";
  children: ReactNode;
  topbar?: ReactNode;
}) {
  return <OrganizationProvider context={context}>
    <AppShell groups={primaryNavigation} route={route} topbar={topbar}
      contentClassName={route === "/assistant" ? "product-content product-content-assistant" : "product-content"}>
      {children}
    </AppShell>
  </OrganizationProvider>;
}
