import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, calendlyConfigured } from "@/lib/integrations/calendly";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!calendlyConfigured()) {
    return NextResponse.redirect(new URL("/follow-up?calendly=notconfigured", request.url));
  }
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(origin, state));
  res.cookies.set("calendly_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
