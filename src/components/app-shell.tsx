"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { selectBranch, selectOrganization } from "@/app/actions/organization";
import { SignOutButton } from "@/components/sign-out-button";
import type { OrganizationContextPayload } from "@/lib/organization-context";

const Context = createContext<OrganizationContextPayload | null>(null);
export const useOrganizationContext = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Organization context is unavailable");
  return value;
};

export function OrganizationIdentity() {
  const { organization, branch } = useOrganizationContext();
  return (
    <div className="company">
      <span>{organization.name}</span>
      <small>{branch.name}</small>
    </div>
  );
}

export function OrganizationSwitcher() {
  const { organization, organizations, branch, branches } =
    useOrganizationContext();
  const router = useRouter();
  async function switchOrganization(id: string) {
    if ((await selectOrganization(id)).ok) router.refresh();
  }
  async function switchBranch(id: string) {
    if ((await selectBranch(id)).ok) router.refresh();
  }
  return (
    <div className="context-switchers">
      {organizations.length > 1 ? (
        <label>
          <span className="sr-only">Organization</span>
          <select
            aria-label="Organization"
            value={organization.id}
            onChange={(event) => switchOrganization(event.target.value)}
          >
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="context-label">{organization.name}</span>
      )}
      {branches.length > 1 ? (
        <label>
          <span className="sr-only">Branch</span>
          <select
            aria-label="Branch"
            value={branch.id}
            onChange={(event) => switchBranch(event.target.value)}
          >
            {branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="context-label muted">{branch.name}</span>
      )}
    </div>
  );
}

export function AccountMenu() {
  const { user, membership } = useOrganizationContext();
  const [open, setOpen] = useState(false);
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="account-menu">
      <button
        className="avatar"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {initials || "U"}
      </button>
      {open && (
        <div className="account-popover">
          <b>{user.displayName}</b>
          <span>
            {membership.role[0].toUpperCase() + membership.role.slice(1)} ·
            active
          </span>
          <SignOutButton label="Sign out" />
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  groups,
  route,
  onNavigate,
}: {
  groups: readonly (readonly [
    string,
    readonly (readonly [string, string])[],
  ])[];
  route: string;
  onNavigate?: () => void;
}) {
  const [mobileGroup, setMobileGroup] = useState<number | null>(() => {
    const active = groups.findIndex(([, items]) =>
      items.some(([, href]) => route === href || (href !== "/" && route.startsWith(href))),
    );
    return active > 0 ? active : null;
  });
  const links = (items: readonly (readonly [string, string])[]) =>
    items.map(([name, href]) => (
      <Link
        onClick={onNavigate}
        className={route === href || (href !== "/" && route.startsWith(href)) ? "active" : ""}
        href={href}
        key={href}
      >
        {name}
      </Link>
    ));
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">L</span>
        <b>Ledgerly</b>
        <button
          className="mobile-close"
          aria-label="Close navigation"
          onClick={onNavigate}
        >
          ×
        </button>
      </div>
      <OrganizationIdentity />
      <nav className="desktop-nav">
        {groups.map(([group, items], groupIndex) => (
          <div className="nav-group" key={`${group}-${groupIndex}`}>
            {group && <p>{group}</p>}
            {links(items)}
          </div>
        ))}
      </nav>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {groups.map(([group, items], groupIndex) =>
          !group ? (
            <div className="mobile-home" key="mobile-home">{links(items)}</div>
          ) : (
            <div className="mobile-nav-group" key={`${group}-${groupIndex}`}>
              <button
                type="button"
                aria-expanded={mobileGroup === groupIndex}
                onClick={() => setMobileGroup(mobileGroup === groupIndex ? null : groupIndex)}
              >
                {group}<span>{mobileGroup === groupIndex ? "−" : "+"}</span>
              </button>
              {mobileGroup === groupIndex && <div>{links(items)}</div>}
            </div>
          ),
        )}
      </nav>
      <div className="demo-label">Ledgerly accounting workspace</div>
    </aside>
  );
}

export function AppShell({
  groups,
  route,
  children,
  topbar,
}: {
  groups: readonly (readonly [
    string,
    readonly (readonly [string, string])[],
  ])[];
  route: string;
  children: ReactNode;
  topbar: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app">
      <div className={menuOpen ? "sidebar-wrap open" : "sidebar-wrap"}>
        <Sidebar
          groups={groups}
          route={route}
          onNavigate={() => setMenuOpen(false)}
        />
      </div>
      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
          {topbar}
          <OrganizationSwitcher />
          <AccountMenu />
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function OrganizationProvider({
  context,
  children,
}: {
  context: OrganizationContextPayload;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
