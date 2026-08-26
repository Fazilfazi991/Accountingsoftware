"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeRequestOrigin } from "@/lib/auth-routing";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) redirect("/forgot-password?error=Enter+a+valid+email+address");
  const requestHeaders = await headers();
  const origin = safeRequestOrigin(requestHeaders.get("origin")) ?? safeRequestOrigin(requestHeaders.get("referer"));
  if (!origin) redirect("/forgot-password?error=Unable+to+verify+the+application+origin");
  await (await createClient()).auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/callback?next=/update-password`,
  });
  redirect("/login?message=If+that+account+exists,+a+password+reset+link+has+been+sent");
}
