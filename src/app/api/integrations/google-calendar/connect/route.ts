import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getCurrentUser } from '@/lib/auth-helper';
import { createAuthenticatedClient, createAdminClient } from '@/lib/supabase';
import { checkStoreAccess } from '@/lib/supabase';
import { shouldSkipAuth } from '@/lib/env';

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
 * GET /api/integrations/google-calendar/connect?store_id=xxx
 * Redirects to Google OAuth. Caller must be store admin or service admin.
 */
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id');
  if (!storeId?.trim()) {
    return NextResponse.json({ error: 'store_id が必要です' }, { status: 400 });
  }

  if (shouldSkipAuth()) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=local`;
    return NextResponse.redirect(redirectUrl);
  }

  const user = await getCurrentUser(request);
  if (!user) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=unauthorized`;
    return NextResponse.redirect(redirectUrl);
  }

  const token = request.cookies.get('sb-access-token')?.value
    || request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=unauthorized`;
    return NextResponse.redirect(redirectUrl);
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=server`;
    return NextResponse.redirect(redirectUrl);
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=forbidden`;
    return NextResponse.redirect(redirectUrl);
  }

  const creds = await getOAuthCredentials();
  if (!creds) {
    const redirectUrl = request.nextUrl.origin + `/admin/${storeId}?google_calendar=error&message=config`;
    return NextResponse.redirect(redirectUrl);
  }

  const redirectUri = `${request.nextUrl.origin}/api/integrations/google-calendar/callback`;
  const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
  const state = Buffer.from(JSON.stringify({ store_id: storeId })).toString('base64url');
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  return NextResponse.redirect(url);
}
