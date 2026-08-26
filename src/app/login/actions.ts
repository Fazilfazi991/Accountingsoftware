"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export async function signIn(formData: FormData) { const email = String(formData.get("email") ?? "").trim(); const password = String(formData.get("password") ?? ""); if (!email || !password) redirect("/login?error=Enter+your+email+and+password"); const { error } = await (await createClient()).auth.signInWithPassword({ email, password }); if (error) redirect("/login?error=Invalid+email+or+password"); redirect("/"); }
