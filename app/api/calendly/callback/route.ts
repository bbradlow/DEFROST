import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, storeTokens, usersMe } from "@/lib/integrations/calendly";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get("calendly_state")?.value;

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/follow-up?calendly=error", request.url));
  }

  try {
    const tokens = await exchangeCode(code, url.origin);
    const me = await usersMe(tokens.access_token);
    await storeTokens(user.id, tokens, {
      user_uri: me.resource.uri,
      organization: me.resource.current_organization,
      email: me.resource.email,
    });
    return NextResponse.redirect(new URL("/follow-up?calendly=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/follow-up?calendly=error", request.url));
  }
}
