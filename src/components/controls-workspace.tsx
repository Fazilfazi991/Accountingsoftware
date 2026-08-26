"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import {
  Fragment,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getAuditLog,
  getControlData,
  getParties,
  saveBranch,
  saveCompany,
  saveParty,
  updateMember,
} from "@/app/actions/controls";
import { useOrganizationContext } from "@/components/app-shell";

const title = (name: string, description: string) => (
  <div className="page-header">
    <div>
      <h1>{name}</h1>
      <p>{description}</p>
    </div>
  </div>
);
const statusClass = (message: string) =>
  message.toLowerCase().includes("saved") ||
  message.toLowerCase().includes("updated")
    ? "success"
    : "error";

export function ControlsWorkspace({
  view,
}: {
  view: "settings" | "audit" | "customer" | "supplier";
}) {
  if (view === "audit") return <AuditLog />;
  if (view === "customer" || view === "supplier")
    return <PartyMaster kind={view} />;
  return <Settings />;
}

function Settings() {
  const { organization, allBranches, membership } = useOrganizationContext();
  const [data, setData] = useState<{
      members: any[];
      locations: any[];
      canManageUsers: boolean;
    } | null>(null),
    [message, setMessage] = useState("");
  const load = useCallback(() => void getControlData().then(setData), []);
  useEffect(load, [load]);
  async function company(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      r = await saveCompany({
        name: f.get("name"),
        legalName: f.get("legalName"),
        trn: f.get("trn"),
        email: f.get("email"),
        phone: f.get("phone"),
        address: f.get("address"),
        emirate: f.get("emirate"),
        countryCode: "AE",
        currency: "AED",
        timezone: "Asia/Dubai",
      });
    setMessage(r.error || "Company settings saved.");
  }
  const canManage = membership.role === "owner" || membership.role === "admin";
  return (
    <>
      {title(
        "Settings",
        `${organization.name} · company, branch, member and accounting controls`,
      )}
      <div className="control-tabs">
        <a href="#company">Company</a>
        <a href="#branches">Branches</a>
        <a href="#members">Members</a>
        <Link href="/accounting/document-numbering">Document numbering</Link>
        <Link href="/settings/audit-log">Audit log</Link>
      </div>
      <form id="company" className="panel form-panel" onSubmit={company}>
        <div className="panel-head">
          <div>
            <h2>Company profile</h2>
            <p>UAE defaults are fixed to AED and Asia/Dubai.</p>
          </div>
          <span className="badge">{membership.role}</span>
        </div>
        <div className="form-grid">
          <label>
            Company name
            <input
              name="name"
              defaultValue={organization.name}
              required
              disabled={!canManage}
            />
          </label>
          <label>
            Legal name
            <input
              name="legalName"
              defaultValue={organization.legalName}
              disabled={!canManage}
            />
          </label>
          <label>
            TRN
            <input
              name="trn"
              defaultValue={organization.trn}
              inputMode="numeric"
              disabled={!canManage}
            />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              defaultValue={organization.email}
              disabled={!canManage}
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              defaultValue={organization.phone}
              disabled={!canManage}
            />
          </label>
          <label>
            Emirate
            <input
              name="emirate"
              defaultValue={organization.emirate}
              disabled={!canManage}
            />
          </label>
          <label>
            Country
            <input value="United Arab Emirates" readOnly />
          </label>
          <label>
            Currency / timezone
            <input value="AED · Asia/Dubai" readOnly />
          </label>
        </div>
        <label className="wide-label">
          Registered address
          <textarea
            name="address"
            defaultValue={organization.address}
            disabled={!canManage}
          />
        </label>
        {canManage && (
          <div className="form-actions">
            <button className="button">Save company</button>
          </div>
        )}
      </form>
      <section id="branches" className="panel control-section">
        <div className="panel-head">
          <div>
            <h2>Branches</h2>
            <p>
              Inactive branches cannot become an active working context. The
              final active branch is protected.
            </p>
          </div>
        </div>
        {allBranches.map((b) => (
          <BranchEditor
            key={b.id}
            branch={b}
            locations={data?.locations || []}
            canManage={canManage}
            onDone={(m) => {
              setMessage(m);
              load();
            }}
          />
        ))}
        {canManage && (
          <BranchEditor
            locations={data?.locations || []}
            canManage
            onDone={(m) => {
              setMessage(m);
              load();
            }}
          />
        )}
      </section>
      <section id="members" className="panel control-section">
        <div className="panel-head">
          <div>
            <h2>Members</h2>
            <p>
              Invitations are deferred; existing memberships can be governed
              here.
            </p>
          </div>
        </div>
        {data?.canManageUsers ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <MemberRow
                    key={m.membership_id}
                    member={m}
                    onDone={(x) => {
                      setMessage(x);
                      load();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="notice">
            Member administration is available to Owner and Admin only.
          </p>
        )}
      </section>
      <section className="panel control-note">
        <h2>Branding and document defaults</h2>
        <p>
          Documents use the legal company profile. Binary logo upload is
          intentionally deferred until a governed storage bucket and image
          validation policy are available.
        </p>
      </section>
      {message && (
        <p className={`control-toast ${statusClass(message)}`}>{message}</p>
      )}
    </>
  );
}
function BranchEditor({
  branch,
  locations,
  canManage,
  onDone,
}: {
  branch?: any;
  locations: any[];
  canManage: boolean;
  onDone: (m: string) => void;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      r = await saveBranch({
        id: branch?.id,
        name: f.get("name"),
        code: f.get("code"),
        address: f.get("address"),
        email: f.get("email"),
        phone: f.get("phone"),
        active: f.get("active") === "on",
        defaultLocationId: String(f.get("location") || "") || undefined,
      });
    onDone(r.error || (branch ? "Branch updated." : "Branch saved."));
  }
  return (
    <form className="branch-editor" onSubmit={submit}>
      <input
        aria-label="Branch name"
        name="name"
        defaultValue={branch?.name || ""}
        placeholder="Branch name"
        required
        disabled={!canManage}
      />
      <input
        aria-label="Branch code"
        name="code"
        defaultValue={branch?.code || ""}
        placeholder="Code"
        disabled={!canManage}
      />
      <input
        aria-label="Branch address"
        name="address"
        defaultValue={branch?.address || ""}
        placeholder="Address"
        disabled={!canManage}
      />
      <input
        aria-label="Branch email"
        name="email"
        type="email"
        defaultValue={branch?.email || ""}
        placeholder="Email"
        disabled={!canManage}
      />
      <input
        aria-label="Branch phone"
        name="phone"
        defaultValue={branch?.phone || ""}
        placeholder="Phone"
        disabled={!canManage}
      />
      <select
        aria-label="Default stock location"
        name="location"
        defaultValue={branch?.defaultLocationId || ""}
        disabled={!canManage || !branch}
      >
        <option value="">No default stock location</option>
        {locations
          .filter((x) => x.branch_id === branch?.id)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
      </select>
      <label className="inline-check">
        <input
          type="checkbox"
          name="active"
          defaultChecked={branch?.active ?? true}
          disabled={!canManage}
        />
        Active
      </label>
      {canManage && (
        <button className="button secondary">
          {branch ? "Save" : "Add branch"}
        </button>
      )}
    </form>
  );
}
function MemberRow({
  member,
  onDone,
}: {
  member: any;
  onDone: (m: string) => void;
}) {
  const [role, setRole] = useState(member.role),
    [active, setActive] = useState(member.membership_status === "active");
  return (
    <tr>
      <td>
        {member.display_name}
        {member.is_owner && <small> Legal owner</small>}
      </td>
      <td>{member.email}</td>
      <td>
        <select
          aria-label={`Role for ${member.display_name}`}
          value={role}
          disabled={member.is_owner}
          onChange={(e) => setRole(e.target.value)}
        >
          {["owner", "admin", "accountant", "staff", "viewer"].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </td>
      <td>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={active}
            disabled={member.is_owner}
            onChange={(e) => setActive(e.target.checked)}
          />
          {active ? "Active" : "Inactive"}
        </label>
      </td>
      <td>
        <button
          className="text-button"
          disabled={member.is_owner}
          onClick={async () => {
            const r = await updateMember({
              membershipId: member.membership_id,
              role,
              status: active ? "active" : "inactive",
            });
            onDone(r.error || "Membership updated.");
          }}
        >
          Save
        </button>
      </td>
    </tr>
  );
}

function AuditLog() {
  const { allBranches } = useOrganizationContext(),
    [filters, setFilters] = useState({
      from: "",
      to: "",
      userId: "",
      action: "",
      branchId: "",
      entityType: "",
    }),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [open, setOpen] = useState<string>("");
  const load = () =>
    void getAuditLog(filters).then((r) => {
      if ("error" in r) setError(r.error || "Unable to load the audit log.");
      else { setRows(r.rows || []); setError(""); }
    });
  // The initial request intentionally uses the empty filter state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);
  const users = useMemo(
      () =>
        Array.from(
          new Map(
            rows
              .filter((r) => r.actor_user_id)
              .map((r) => [
                r.actor_user_id,
                { id: r.actor_user_id, name: r.actor_name },
              ]),
          ).values(),
        ),
      [rows],
    ),
    actions = useMemo(
      () => Array.from(new Set(rows.map((r) => r.event_type))).sort(),
      [rows],
    ),
    entities = useMemo(
      () => Array.from(new Set(rows.map((r) => r.entity_type))).sort(),
      [rows],
    );
  return (
    <>
      {title(
        "Audit log",
        "Immutable organization activity from real accounting and administrative events.",
      )}
      <section className="panel">
        <form
          className="audit-filters"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <label>
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
          <label>
            User
            <select
              value={filters.userId}
              onChange={(e) =>
                setFilters({ ...filters, userId: e.target.value })
              }
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              value={filters.action}
              onChange={(e) =>
                setFilters({ ...filters, action: e.target.value })
              }
            >
              <option value="">All actions</option>
              {actions.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select
              value={filters.branchId}
              onChange={(e) =>
                setFilters({ ...filters, branchId: e.target.value })
              }
            >
              <option value="">All branches</option>
              {allBranches.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Entity
            <select
              value={filters.entityType}
              onChange={(e) =>
                setFilters({ ...filters, entityType: e.target.value })
              }
            >
              <option value="">All entities</option>
              {entities.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button className="button">Apply</button>
        </form>
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity / reference</th>
                  <th>Branch</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td>{new Date(r.created_at).toLocaleString("en-AE")}</td>
                      <td>
                        {r.actor_name}
                        <small>{r.actor_email}</small>
                      </td>
                      <td>
                        <span className="badge">{r.event_type}</span>
                      </td>
                      <td>
                        {r.entity_type}
                        <small>{r.entity_id || "—"}</small>
                      </td>
                      <td>{r.branch_name || "Organization-wide"}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setOpen(open === r.id ? "" : r.id)}
                        >
                          {r.description}
                        </button>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr key={`${r.id}-detail`} className="audit-detail">
                        <td colSpan={6}>
                          <strong>Recorded metadata</strong>
                          <pre>{JSON.stringify(r.metadata, null, 2)}</pre>
                          <span>Correlation/event ID: {r.id}</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!error && !rows.length && (
          <p className="empty">No audit events match these filters.</p>
        )}
      </section>
    </>
  );
}

function PartyMaster({ kind }: { kind: "customer" | "supplier" }) {
  const label = kind === "customer" ? "Customer" : "Supplier",
    [rows, setRows] = useState<any[]>([]),
    [editing, setEditing] = useState<any | null>(null),
    [show, setShow] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(
    () =>
      void getParties(kind).then((r) => "rows" in r && setRows(r.rows || [])),
    [kind],
  );
  useEffect(load, [load]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      r = await saveParty({
        id: editing?.id,
        kind,
        name: f.get("name"),
        trn: f.get("trn"),
        email: f.get("email"),
        phone: f.get("phone"),
        address: f.get("address"),
        paymentTermsDays: Number(f.get("terms")),
        active: f.get("active") === "on",
      });
    setMessage(r.error || `${label} saved.`);
    if (!r.error) {
      setShow(false);
      setEditing(null);
      load();
    }
  }
  return (
    <>
      {title(
        `${label}s`,
        `Real organization-scoped ${label.toLowerCase()} master data.`,
      )}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{label} register</h2>
            <p>Contact, UAE TRN, payment terms and lifecycle status.</p>
          </div>
          <button
            className="button"
            onClick={() => {
              setEditing(null);
              setShow(true);
            }}
          >
            + New {label.toLowerCase()}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>TRN</th>
                <th>Email / phone</th>
                <th>Terms</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.trn || "—"}</td>
                  <td>
                    {r.email || "—"}
                    <small>{r.phone || ""}</small>
                  </td>
                  <td>{r.payment_terms_days} days</td>
                  <td>
                    <span className={`badge ${r.is_active ? "b-posted" : ""}`}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditing(r);
                        setShow(true);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">No {label.toLowerCase()} records yet.</p>
        )}
      </section>
      {show && (
        <form className="panel form-panel party-form" onSubmit={submit}>
          <div className="panel-head">
            <h2>
              {editing
                ? `Edit ${label.toLowerCase()}`
                : `New ${label.toLowerCase()}`}
            </h2>
            <button
              type="button"
              className="text-button"
              onClick={() => setShow(false)}
            >
              Close
            </button>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input name="name" defaultValue={editing?.name || ""} required />
            </label>
            <label>
              TRN
              <input name="trn" defaultValue={editing?.trn || ""} />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={editing?.email || ""}
              />
            </label>
            <label>
              Phone
              <input name="phone" defaultValue={editing?.phone || ""} />
            </label>
            <label>
              Payment terms (days)
              <input
                name="terms"
                type="number"
                min="0"
                defaultValue={editing?.payment_terms_days ?? 30}
              />
            </label>
            <label className="inline-check">
              Active
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.is_active ?? true}
              />
            </label>
          </div>
          <label className="wide-label">
            Billing address
            <textarea
              name="address"
              defaultValue={editing?.billing_address || ""}
            />
          </label>
          <div className="form-actions">
            <button className="button">Save {label.toLowerCase()}</button>
          </div>
        </form>
      )}
      {message && (
        <p className={`control-toast ${statusClass(message)}`}>{message}</p>
      )}
    </>
  );
}
