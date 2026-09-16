"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AccountMenu, AppShell, OrganizationProvider, OrganizationSwitcher } from "@/components/app-shell";
import { primaryNavigation } from "@/components/primary-navigation";
import type { OrganizationContextPayload } from "@/lib/organization-context";
import { BrandLogo } from "@/components/brand-logo";

export function ProductWorkspace({ context, route, children, topbar = null }: {
  context: OrganizationContextPayload;
  route: "/" | "/today" | "/assistant" | "/general";
  children: ReactNode;
  topbar?: ReactNode;
}) {
  return <OrganizationProvider context={context}>
    <AppShell groups={primaryNavigation} route={route} topbar={topbar}
      contentClassName={route === "/assistant" || route === "/general" ? "product-content product-content-assistant" : "product-content"}>
      {children}
    </AppShell>
  </OrganizationProvider>;
}

export function AiWorkspaceShell({ context, route, children }: {
  context: OrganizationContextPayload;
  route: "/assistant" | "/general";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mode = route === "/assistant" ? "Ask FYNTA" : "Ask General";
  const reset = () => { window.dispatchEvent(new Event("ledgerly:new-conversation")); setOpen(false); };
  return <OrganizationProvider context={context}>
    <div className="app ai-app">
      {open && <button className="ai-sidebar-backdrop" type="button" aria-label="Close AI workspace navigation" onClick={() => setOpen(false)} />}
      <aside className={open ? "ai-sidebar open" : "ai-sidebar"} aria-label="AI workspace navigation">
        <div className="ai-brand"><BrandLogo variant="dark" className="ai-brand-logo" /></div>
             <button className="ai-new-chat" type="button" onClick={reset}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New conversation</button>
        <div className="ai-history">
          <p>Today</p><Link className={route === "/assistant" ? "active" : ""} href="/assistant" onClick={() => setOpen(false)}>Business questions</Link><Link className={route === "/general" ? "active" : ""} href="/general" onClick={() => setOpen(false)}>New conversation</Link>
          <p>Yesterday</p><Link href={route}>Monthly review</Link>
          <p>Previous 7 days</p><Link href={route}>Outstanding items</Link><Link href={route}>Planning notes</Link>
        </div>
        <div className="ai-sidebar-footer"><Link className={route === "/assistant" ? "active" : ""} href="/assistant" onClick={() => setOpen(false)}>Ask FYNTA</Link><Link className={route === "/general" ? "active" : ""} href="/general" onClick={() => setOpen(false)}>Ask General</Link><Link className="ai-back" href="/today" onClick={() => setOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /><path d="M8 12h11" /></svg> Back to FYNTA</Link></div>
      </aside>
      <main className="main ai-main">
        <header className="topbar ai-topbar"><button className="ai-mobile-menu" type="button" aria-label="Open AI workspace navigation" aria-expanded={open} onClick={() => setOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button><span className="ai-mobile-title">{mode}</span><OrganizationSwitcher /><AccountMenu /></header>
        <div className="content product-content product-content-assistant">{children}</div>
      </main>
    </div>
  </OrganizationProvider>;
}
