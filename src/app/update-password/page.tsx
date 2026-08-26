import { redirect } from "next/navigation";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "./actions";

export default async function UpdatePassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login?error=Open+the+latest+password+reset+link+to+continue");
  const { error } = await searchParams;
  return <main className="auth-page"><form action={updatePassword} className="auth-card"><div className="auth-brand"><span className="brand-mark">L</span><b>Ledgerly</b></div><h1>Choose a new password</h1><p>Use at least 12 characters.</p><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>{error && <p className="error">{error}</p>}<AuthSubmitButton idle="Update password" pending="Updating…" /></form></main>;
}
