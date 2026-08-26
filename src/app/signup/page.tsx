import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { createClient } from "@/lib/supabase/server";
import { signUp } from "./actions";

export default async function Signup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user) redirect("/");
  const { error } = await searchParams;
  return <main className="auth-page"><form action={signUp} className="auth-card"><div className="auth-brand"><span className="brand-mark">L</span><b>Ledgerly</b></div><h1>Create account</h1><p>Create your secure Ledgerly login, then set up your company.</p><label>Name<input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>{error && <p className="error">{error}</p>}<AuthSubmitButton idle="Create account" pending="Creating account…" /><Link className="auth-link-single" href="/login">Back to sign in</Link></form></main>;
}
