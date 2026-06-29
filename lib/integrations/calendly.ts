/**
 * Calendly API v2 client (server-only). OAuth 2.0 authorization-code flow.
 *   authorize: https://auth.calendly.com/oauth/authorize
 *   token:     https://auth.calendly.com/oauth/token   (form-urlencoded)
 *   api:       https://api.calendly.com
 * Access tokens expire after 2h; we refresh with the stored refresh token.
 * Tokens live in the integration_tokens table and are only ever read/written
 * server-side via the service-role admin client.
 */

import { createAdminClient } from "@/lib/supabase/server";

const AUTH = "https://auth.calendly.com";
const API = "https://api.calendly.com";
const PROVIDER = "calendly";

export function calendlyConfigured(): boolean {
  return !!process.env.CALENDLY_CLIENT_ID && !!process.env.CALENDLY_CLIENT_SECRET;
}

/** The redirect URI must EXACTLY match what's registered in the Calendly app. */
export function redirectUri(origin: string): string {
  return process.env.CALENDLY_REDIRECT_URI || `${origin}/api/calendly/callback`;
}

export function authorizeUrl(origin: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: process.env.CALENDLY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri(origin),
    state,
  });
  return `${AUTH}/oauth/authorize?${qs.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Calendly token error ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string, origin: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.CALENDLY_CLIENT_ID ?? "",
    client_secret: process.env.CALENDLY_CLIENT_SECRET ?? "",
    code,
    redirect_uri: redirectUri(origin),
  });
}

async function refresh(refreshToken: string) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: process.env.CALENDLY_CLIENT_ID ?? "",
    client_secret: process.env.CALENDLY_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
  });
}

export async function storeTokens(
  ownerId: string,
  t: TokenResponse,
  meta?: Record<string, unknown>,
) {
  const admin = createAdminClient();
  const expires_at = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  await admin.from("integration_tokens").upsert(
    {
      owner_id: ownerId,
      provider: PROVIDER,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at,
      meta: meta ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,provider" },
  );
}

export async function isConnected(ownerId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_tokens")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return !!data;
}

/** Return a valid access token, refreshing + persisting if it has expired. */
export async function getValidToken(ownerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("owner_id", ownerId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data) return null;

  const expired = !data.expires_at || Date.parse(data.expires_at) <= Date.now();
  if (!expired) return data.access_token;
  if (!data.refresh_token) return data.access_token; // best effort

  const refreshed = await refresh(data.refresh_token);
  await storeTokens(ownerId, refreshed);
  return refreshed.access_token;
}

async function apiGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Calendly API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export type CalendlyUser = {
  resource: { uri: string; name: string; email: string; current_organization: string };
};

export function usersMe(token: string) {
  return apiGet<CalendlyUser>(token, "/users/me");
}

export type ScheduledEvent = {
  uri: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
};

export async function listScheduledEvents(
  token: string,
  userUri: string,
  minStartTime: string,
) {
  const qs = new URLSearchParams({
    user: userUri,
    min_start_time: minStartTime,
    count: "100",
    status: "active",
  });
  const data = await apiGet<{ collection: ScheduledEvent[] }>(
    token,
    `/scheduled_events?${qs.toString()}`,
  );
  return data.collection ?? [];
}

export type Invitee = { email: string; name: string };

export async function listInvitees(token: string, eventUri: string) {
  // event uri looks like https://api.calendly.com/scheduled_events/{uuid}
  const uuid = eventUri.split("/").pop() ?? "";
  const data = await apiGet<{ collection: Invitee[] }>(
    token,
    `/scheduled_events/${uuid}/invitees?count=100`,
  );
  return data.collection ?? [];
}
