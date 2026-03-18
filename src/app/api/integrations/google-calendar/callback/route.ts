import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createAdminClient } from '@/lib/supabase';
import { encryptRefreshToken } from '@/lib/google-calendar-token';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

async function getOAuthCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const fromEnv =
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? {
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        }
      : null;
  if (fromEnv) return fromEnv;

  const adminClient = createAdminClient();
  if (!adminClient) return null;

  const { data: rows, error } = await (adminClient as any)
    .from('admin_settings')
    .select('key, value')
    .in('key', ['google_oauth_client_id', 'google_oauth_client_secret']);

  if (error || !rows?.length) return null;

  const map = (rows as { key: string; value: string | null }[]).reduce(
    (acc, r) => {
      acc[r.key] = r.value || '';
      return acc;
    },
    {} as Record<string, string>
  );
  const clientId = map.google_oauth_client_id?.trim();
  const clientSecret = map.google_oauth_client_secret?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * GET /api/integrations/google-calendar/callback?code=...&state=...
 * Exchanges code for tokens, fetches primary calendar id, saves encrypted refresh token to store.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const stateRaw = request.nextUrl.searchParams.get('state');
  const origin = request.nextUrl.origin;

  let storeId: string;
  try {
    if (!stateRaw) throw new Error('missing state');
    const decoded = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    storeId = decoded?.store_id;
    if (!storeId || typeof storeId !== 'string') throw new Error('invalid state');
  } catch {
    return NextResponse.redirect(`${origin}/admin?google_calendar=error&message=invalid_state`);
  }

  if (!code?.trim()) {
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=no_code`);
  }

  const creds = await getOAuthCredentials();
  if (!creds) {
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=config`);
  }

  const redirectUri = `${origin}/api/integrations/google-calendar/callback`;
  const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);

  let tokens;
  try {
    const { tokens: t } = await oauth2.getToken(code);
    tokens = t;
  } catch (err) {
    console.error('[GoogleCalendar] Token exchange error:', err);
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=exchange`);
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=no_refresh_token`);
  }

  oauth2.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  let calendarId = 'primary';
  try {
    const list = await calendar.calendarList.list();
    const primary = list.data.items?.find((c) => c.primary);
    if (primary?.id) calendarId = primary.id;
  } catch (err) {
    console.error('[GoogleCalendar] Calendar list error:', err);
  }

  const encrypted = encryptRefreshToken(tokens.refresh_token);
  if (!encrypted) {
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=encryption`);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=server`);
  }

  const { error } = await (adminClient as any)
    .from('stores')
    .update({
      google_calendar_source: 'store_oauth',
      google_calendar_id: calendarId,
      google_calendar_refresh_token: encrypted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storeId);

  if (error) {
    console.error('[GoogleCalendar] Store update error:', error);
    return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=error&message=save`);
  }

  return NextResponse.redirect(`${origin}/admin/${storeId}?google_calendar=connected`);
}
