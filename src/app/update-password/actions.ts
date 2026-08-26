"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 12 || password.length > 128) redirect("/update-password?error=Password+must+be+between+12+and+128+characters");
  if (password !== confirmation) redirect("/update-password?error=Passwords+do+not+match");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=Open+the+latest+password+reset+link+to+continue");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/update-password?error=Password+could+not+be+updated");
  await supabase.auth.signOut();
  redirect("/login?message=Password+updated.+Sign+in+with+your+new+password");
}
