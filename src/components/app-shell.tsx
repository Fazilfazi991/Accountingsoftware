"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { selectBranch, selectOrganization } from "@/app/actions/organization";
import { SignOutButton } from "@/components/sign-out-button";
import type { OrganizationContextPayload } from "@/lib/organization-context";

export type NavigationIcon =
  | "overview"
  | "sales"
  | "purchases"
  | "inventory"
  | "accounts"
  | "reports"
  | "masters"
  | "settings";

export type NavigationGroup = {
  label: string;
  icon: NavigationIcon;
  href?: string;
  sections?: readonly {
    label?: string;
    items: readonly (readonly [string, string])[];
  }[];
};

const Context = createContext<OrganizationContextPayload | null>(null);
export const useOrganizationContext = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Organization context is unavailable");
  return value;
};

function NavigationGlyph({ name }: { name: NavigationIcon }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<NavigationIcon, ReactNode> = {
    overview: <path d="M3.5 3.5h7v7h-7zM13.5 3.5h7v4h-7zM13.5 10.5h7v10h-7zM3.5 13.5h7v7h-7z" />,
    sales: <><path d="M4 19V8.5L12 4l8 4.5V19" /><path d="M7.5 19v-6h9v6M8 9.5h.01M12 9.5h.01M16 9.5h.01" /></>,
    purchases: <><path d="M4 6h2l1.7 9.2h9.8l2-6.2H7" /><path d="M10 20h.01M17 20h.01" /></>,
    inventory: <><path d="m4 7 8-4 8 4-8 4z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10" /></>,
    accounts: <><path d="M4 8.5h16M5.5 8.5V19M10 8.5V19M14 8.5V19M18.5 8.5V19M3.5 19h17" /><path d="m12 3 8 4H4z" /></>,
    reports: <path d="M5 20V10M10 20V4M15 20v-7M20 20V7" />,
    masters: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="7" r="2.5" /><path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h1a4.5 4.5 0 0 1 4.5 4.5V20M14 12h3.5a3 3 0 0 1 3 3v2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.38.25.72.6.6 1v.4h1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

const isActiveRoute = (route: string, href: string) =>
  route === href || (href !== "/" && route.startsWith(`${href}/`));

const groupIsActive = (group: NavigationGroup, route: string) =>
  (group.href ? isActiveRoute(route, group.href) : false) ||
  group.sections?.some((section) =>
    section.items.some(([, href]) => isActiveRoute(route, href)),
  );

const sidebarPreferenceKey = "ledgerly-sidebar-collapsed";
const sidebarPreferenceEvent = "ledgerly-sidebar-preference";
const subscribeSidebarPreference = (onStoreChange: () => void) => {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(sidebarPreferenceEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(sidebarPreferenceEvent, onStoreChange);
  };
};
const getSidebarPreference = () =>
  window.localStorage.getItem(sidebarPreferenceKey) === "true";

export function OrganizationIdentity() {
  const { organization, branch } = useOrganizationContext();
  return <div className="company"><span>{organization.name}</span><small>{branch.name}</small></div>;
}

export function OrganizationSwitcher() {
  const { organization, organizations, branch, branches } = useOrganizationContext();
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
        <label><span className="sr-only">Organization</span><select aria-label="Organization" value={organization.id} onChange={(event) => switchOrganization(event.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      ) : <span className="context-label">{organization.name}</span>}
      {branches.length > 1 ? (
        <label><span className="sr-only">Branch</span><select aria-label="Branch" value={branch.id} onChange={(event) => switchBranch(event.target.value)}>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      ) : <span className="context-label muted">{branch.name}</span>}
    </div>
  );
}

export function AccountMenu() {
  const { user, membership } = useOrganizationContext();
  const [open, setOpen] = useState(false);
  const initials = user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="account-menu">
      <button className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>{initials || "U"}</button>
      {open && <div className="account-popover"><b>{user.displayName}</b><span>{membership.role[0].toUpperCase() + membership.role.slice(1)} · active</span><SignOutButton label="Sign out" /></div>}
    </div>
  );
}

export function Sidebar({ groups, route, collapsed, onToggleCollapsed, onNavigate }: {
  groups: readonly NavigationGroup[];
  route: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
}) {
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [mobileGroup, setMobileGroup] = useState<number | null>(() => {
    const active = groups.findIndex((group) => groupIsActive(group, route));
    return active > 0 ? active : null;
  });
  const flyoutRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (openGroup === null) return;
    const focusFrame = window.requestAnimationFrame(() => {
      flyoutRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenGroup(null);
        triggerRefs.current[openGroup]?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!flyoutRef.current?.contains(target) && !triggerRefs.current.some((trigger) => trigger?.contains(target))) setOpenGroup(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openGroup]);

  const navigate = () => {
    setOpenGroup(null);
    onNavigate?.();
  };
  const renderSections = (group: NavigationGroup) =>
    group.sections?.map((section, sectionIndex) => (
      <div className="nav-flyout-section" key={`${section.label ?? "links"}-${sectionIndex}`}>
        {section.label && <p>{section.label}</p>}
        <div>{section.items.map(([name, href]) => (
          <Link className={isActiveRoute(route, href) ? "active" : ""} href={href} key={href} onClick={navigate}>
            <span>{name}</span><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
          </Link>
        ))}</div>
      </div>
    ));

  const activeFlyout = openGroup === null ? null : groups[openGroup];
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="brand">
        <span className="brand-mark">L</span><b>Ledgerly</b>
        <button className="mobile-close" aria-label="Close navigation" onClick={onNavigate}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
      <OrganizationIdentity />
      <nav className="desktop-nav" aria-label="Primary navigation">
        {groups.map((group, groupIndex) => {
          const active = groupIsActive(group, route);
          const content = <><span className="nav-icon"><NavigationGlyph name={group.icon} /></span><span className="nav-label">{group.label}</span>{group.sections && <span className="nav-chevron" aria-hidden="true">›</span>}{openGroup === null && <span className="nav-tooltip" role="tooltip">{group.label}</span>}</>;
          return group.href ? (
            <Link aria-label={group.label} className={active ? "primary-nav-item active" : "primary-nav-item"} href={group.href} key={group.label} onClick={navigate}>{content}</Link>
          ) : (
            <button aria-label={group.label} aria-controls={`nav-flyout-${groupIndex}`} aria-expanded={openGroup === groupIndex} className={`${active ? "primary-nav-item active" : "primary-nav-item"}${openGroup === groupIndex ? " open" : ""}`} key={group.label} onClick={() => setOpenGroup(openGroup === groupIndex ? null : groupIndex)} ref={(node) => { triggerRefs.current[groupIndex] = node; }} type="button">{content}</button>
          );
        })}
      </nav>
      {activeFlyout?.sections && openGroup !== null && (
        <div aria-label={`${activeFlyout.label} navigation`} className="nav-flyout" id={`nav-flyout-${openGroup}`} ref={flyoutRef}>
          <div className="nav-flyout-head">
            <div><span className="nav-flyout-icon"><NavigationGlyph name={activeFlyout.icon} /></span><h2>{activeFlyout.label}</h2></div>
            <button aria-label={`Close ${activeFlyout.label} navigation`} onClick={() => { setOpenGroup(null); triggerRefs.current[openGroup]?.focus(); }} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          </div>
          <div className="nav-flyout-body">{renderSections(activeFlyout)}</div>
        </div>
      )}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {groups.map((group, groupIndex) => {
          const active = groupIsActive(group, route);
          return group.href ? (
            <Link className={active ? "mobile-primary-link active" : "mobile-primary-link"} href={group.href} key={group.label} onClick={navigate}><span className="nav-icon"><NavigationGlyph name={group.icon} /></span><span>{group.label}</span></Link>
          ) : (
            <div className="mobile-nav-group" key={group.label}>
              <button aria-controls={`mobile-nav-${groupIndex}`} aria-expanded={mobileGroup === groupIndex} className={active ? "active" : ""} onClick={() => setMobileGroup(mobileGroup === groupIndex ? null : groupIndex)} type="button"><span className="nav-icon"><NavigationGlyph name={group.icon} /></span><span className="mobile-nav-label">{group.label}</span><svg className="mobile-nav-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m3 6 5 5 5-5" /></svg></button>
              {mobileGroup === groupIndex && <div className="mobile-nav-sections" id={`mobile-nav-${groupIndex}`}>{renderSections(group)}</div>}
            </div>
          );
        })}
      </nav>
      <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="sidebar-toggle" onClick={onToggleCollapsed} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d={collapsed ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} /></svg><span>{collapsed ? "Expand" : "Collapse"}</span></button>
      <div className="demo-label">Ledgerly accounting workspace</div>
    </aside>
  );
}

export function AppShell({ groups, route, children, topbar }: {
  groups: readonly NavigationGroup[];
  route: string;
  children: ReactNode;
  topbar: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarWrapRef = useRef<HTMLDivElement>(null);
  const collapsed = useSyncExternalStore(
    subscribeSidebarPreference,
    getSidebarPreference,
    () => false,
  );
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      sidebarWrapRef.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sidebarWrapRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), select, input") ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, menuOpen]);
  const toggleCollapsed = () => {
    window.localStorage.setItem(sidebarPreferenceKey, String(!collapsed));
    window.dispatchEvent(new Event(sidebarPreferenceEvent));
  };
  return (
    <div className="app">
      {menuOpen && <button aria-label="Close navigation" className="sidebar-backdrop" onClick={closeMenu} type="button" />}
      <div className={menuOpen ? "sidebar-wrap open" : "sidebar-wrap"} ref={sidebarWrapRef}>
        <Sidebar collapsed={collapsed} groups={groups} onNavigate={() => { if (menuOpen) closeMenu(); }} onToggleCollapsed={toggleCollapsed} route={route} />
      </div>
      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} ref={menuButtonRef}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
          {topbar}<OrganizationSwitcher /><AccountMenu />
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function OrganizationProvider({ context, children }: { context: OrganizationContextPayload; children: ReactNode; }) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
