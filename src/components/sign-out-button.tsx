"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ label }: { label?: string }) {
  return <button className={label ? "sign-out" : "avatar"} aria-label="Sign out" title="Sign out" onClick={async () => { await createClient().auth.signOut(); window.location.replace("/login"); }}>{label ?? "↗"}</button>;
}
