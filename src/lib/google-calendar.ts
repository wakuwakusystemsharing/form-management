import { google } from 'googleapis';
import { createAdminClient } from './supabase';
import { decryptRefreshToken } from './google-calendar-token';

const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.acls'
];

/**
 * 店舗用カレンダー作成時に常に writer で共有する Google アカウント（サービス運用用）。
 * このメールで Google Calendar にログインすると「カレンダーを追加」で表示・編集できる。
 */
const DEFAULT_CALENDAR_SHARE_EMAIL = 'wakuwakusystemsharing@gmail.com';

function parseServiceAccountJson(raw: string): { client_email?: string; private_key?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

async function getServiceAccountJson(): Promise<string | null> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }

  const adminClient = createAdminClient();
  if (!adminClient) return null;

  const { data, error } = await (adminClient as any)
    .from('admin_settings')
    .select('value')
    .eq('key', 'google_service_account_json')
    .maybeSingle();

  if (error) {
    console.error('[GoogleCalendar] admin_settings fetch error:', error);
    return null;
  }

  return data?.value || null;
}

async function getOAuthClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET
    };
  }
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

async function getServiceAccountCalendarClient() {
  const rawJson = await getServiceAccountJson();
  if (!rawJson) return null;

  const credentials = parseServiceAccountJson(rawJson);
  if (!credentials?.client_email || !credentials?.private_key) {
    console.error('[GoogleCalendar] Invalid service account JSON');
    return null;
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: GOOGLE_CALENDAR_SCOPES
  });

  return google.calendar({ version: 'v3', auth });
}

/**
 * Returns Calendar API client for the store. Uses store OAuth when store has google_calendar_source = 'store_oauth',
 * otherwise uses the service account client.
 */
async function getCalendarClientForStore(storeId: string): Promise<ReturnType<typeof google.calendar> | null> {
  const adminClient = createAdminClient();
  if (!adminClient) return null;

  const { data: store, error } = await (adminClient as any)
    .from('stores')
    .select('google_calendar_source, google_calendar_refresh_token')
    .eq('id', storeId)
    .single();

  if (error || !store) return null;
  if (store.google_calendar_source === 'store_oauth' && store.google_calendar_refresh_token) {
    const creds = await getOAuthClientCredentials();
    if (!creds) return null;
    const refreshToken = decryptRefreshToken(store.google_calendar_refresh_token);
    if (!refreshToken) return null;
    const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, 'https://localhost/callback');
    oauth2.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth: oauth2 });
  }
  return getServiceAccountCalendarClient();
}

/**
 * Returns Calendar API client. When storeId is provided and the store uses store_oauth, uses that store's OAuth client; otherwise uses service account.
 */
async function getCalendarClient(storeId?: string) {
  if (storeId) {
    const client = await getCalendarClientForStore(storeId);
    if (client) return client;
  }
  return getServiceAccountCalendarClient();
}

function buildMenuLines(selectedMenus: Array<Record<string, any>> | undefined) {
  const menus = selectedMenus || [];
  return menus
    .map(menu => {
      const name = menu.menu_name || '';
      const submenu = menu.submenu_name ? ` > ${menu.submenu_name}` : '';
      return `${name}${submenu}`.trim();
    })
    .filter(Boolean);
}

function calculateDurationMinutes(
  selectedMenus: Array<Record<string, any>> | undefined,
  selectedOptions: Array<Record<string, any>> | undefined
) {
  const menuMinutes = (selectedMenus || []).reduce((sum, menu) => sum + (menu.duration || 0), 0);
  const optionMinutes = (selectedOptions || []).reduce((sum, opt) => sum + (opt.duration || 0), 0);
  const total = menuMinutes + optionMinutes;
  return total > 0 ? total : 60;
}

/**
 * 店舗用 Google カレンダーを作成し、指定メールとデフォルト運用アカウントに共有する。
 * @param storeName カレンダー名に使う店舗名
 * @param shareWithEmail 追加で共有するメール（例: 店舗オーナー）。省略時はデフォルト共有のみ。
 * @returns 作成したカレンダーID。共有に失敗してもIDは返す。
 */
export async function createStoreCalendar(storeName: string, shareWithEmail?: string | null) {
  const calendar = await getCalendarClient();
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  const response = await calendar.calendars.insert({
    requestBody: {
      summary: `予約 - ${storeName}`,
      timeZone: 'Asia/Tokyo'
    }
  });

  const calendarId = response.data.id || null;
  if (!calendarId) return null;

  const emailsToShare = new Set<string>([DEFAULT_CALENDAR_SHARE_EMAIL]);
  if (shareWithEmail && shareWithEmail.trim()) {
    emailsToShare.add(shareWithEmail.trim());
  }

  for (const email of emailsToShare) {
    try {
      await calendar.acl.insert({
        calendarId,
        requestBody: {
          role: 'writer',
          scope: { type: 'user', value: email }
        }
      });
    } catch (aclError) {
      console.error(`[GoogleCalendar] ACL insert failed for ${email}:`, aclError);
      // 共有失敗でもカレンダー作成は成功として扱う
    }
  }

  return calendarId;
}

export async function listCalendarEvents(
  calendarId: string,
  startIso: string,
  endIso: string,
  storeId?: string
) {
  const calendar = await getCalendarClient(storeId);
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  const response = await calendar.events.list({
    calendarId,
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
    orderBy: 'startTime'
  });

  return response.data.items || [];
}

export async function createReservationEvent(
  params: {
    calendarId: string;
    reservationDate: string;
    reservationTime: string;
    customerName: string;
    customerPhone: string;
    lineUserId?: string | null;
    lineDisplayName?: string | null;
    message?: string | null;
    selectedMenus?: Array<Record<string, any>>;
    selectedOptions?: Array<Record<string, any>>;
  },
  storeId?: string
) {
  const calendar = await getCalendarClient(storeId);
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  const durationMinutes = calculateDurationMinutes(params.selectedMenus, params.selectedOptions);
  const startDate = new Date(`${params.reservationDate}T${params.reservationTime}:00+09:00`);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const menuLines = buildMenuLines(params.selectedMenus);
  const menuText = menuLines.length > 0 ? menuLines.map(line => `・${line}`).join('\n') : '';

  const description = [
    `≪希望日時≫ ${params.reservationDate} ${params.reservationTime}`,
    `≪LINEの名前≫ ${params.lineDisplayName || ''}`,
    `≪お名前≫ ${params.customerName}`,
    `≪電話番号≫ ${params.customerPhone}`,
    `≪メニュー≫`,
    menuText,
    `≪メッセージ≫`,
    params.message || ''
  ].join('\n');

  const response = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: `予約: ${params.customerName}`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      description,
      location: params.lineUserId || undefined
    }
  });

  return response.data.id || null;
}

export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
  storeId?: string
) {
  const calendar = await getCalendarClient(storeId);
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  await calendar.events.delete({
    calendarId,
    eventId
  });
}
