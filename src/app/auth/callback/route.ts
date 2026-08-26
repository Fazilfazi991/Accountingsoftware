import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth-routing";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=Invalid+or+expired+authentication+link", request.url));
  const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=Invalid+or+expired+authentication+link", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
