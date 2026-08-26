import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { createClient } from "@/lib/supabase/server";
import { signIn } from "./actions";
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) { const {data:{user}}=await (await createClient()).auth.getUser(); if(user) redirect('/'); const { error, message } = await searchParams; return <main className="auth-page"><form action={signIn} className="auth-card"><div className="auth-brand"><span className="brand-mark">L</span><b>Ledgerly</b></div><h1>Sign in</h1><p>Access your Ledgerly workspace.</p><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}<AuthSubmitButton idle="Sign in" pending="Signing in…" /><div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><Link href="/signup">Create account</Link></div></form></main>; }
