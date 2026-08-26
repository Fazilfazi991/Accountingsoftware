"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeRequestOrigin } from "@/lib/auth-routing";
import { createClient } from "@/lib/supabase/server";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().trim(),
  password: z.string().min(12).max(128),
});

export async function signUp(formData: FormData) {
  const input = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.success) redirect("/signup?error=Enter+valid+details+and+a+password+of+at+least+12+characters");

  const requestHeaders = await headers();
  const origin = safeRequestOrigin(requestHeaders.get("origin")) ?? safeRequestOrigin(requestHeaders.get("referer"));
  if (!origin) redirect("/signup?error=Unable+to+verify+the+application+origin");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.data.email,
    password: input.data.password,
    options: {
      data: { display_name: input.data.name },
      emailRedirectTo: `${origin}/auth/callback?next=/`,
    },
  });
  if (error) redirect("/signup?error=Account+could+not+be+created");
  if (data.session) redirect("/onboarding");
  redirect("/login?message=Check+your+email+to+confirm+your+account");
}
