import Link from "next/link";
import { AuthSubmitButton } from "@/components/auth-submit-button";
import { requestPasswordReset } from "./actions";

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="auth-page"><form action={requestPasswordReset} className="auth-card"><div className="auth-brand"><span className="brand-mark">L</span><b>Ledgerly</b></div><h1>Reset password</h1><p>We will send a secure password reset link if the account exists.</p><label>Email<input name="email" type="email" autoComplete="email" required /></label>{error && <p className="error">{error}</p>}<AuthSubmitButton idle="Send reset link" pending="Sending…" /><Link className="auth-link-single" href="/login">Back to sign in</Link></form></main>;
}
