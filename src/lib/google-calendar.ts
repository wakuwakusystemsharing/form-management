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
export async function getCalendarClientForStore(storeId: string): Promise<ReturnType<typeof google.calendar> | null> {
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
      const parts = [menu.category_name, menu.menu_name, menu.submenu_name]
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean);
      return parts.join(' > ');
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

function calculateTotalPrice(
  selectedMenus: Array<Record<string, any>> | undefined,
  selectedOptions: Array<Record<string, any>> | undefined
) {
  const menuYen = (selectedMenus || []).reduce((sum, menu) => sum + (menu.price || 0), 0);
  const optionYen = (selectedOptions || []).reduce((sum, opt) => sum + (opt.price || 0), 0);
  return menuYen + optionYen;
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

/**
 * 複数カレンダーの指定時間帯の空きを一括照会し、「埋まっている」カレンダーIDの集合を返す。
 * freeBusy API を使うため1リクエストで済む（スタッフ選択の指名なし割当・直前再チェック用）。
 * 照会エラーになったカレンダーは安全側（埋まっている扱い）にする。
 */
export async function getBusyCalendars(
  calendarIds: string[],
  startIso: string,
  endIso: string,
  storeId?: string
): Promise<Set<string>> {
  const busy = new Set<string>();
  if (calendarIds.length === 0) return busy;
  const calendar = await getCalendarClient(storeId);
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startIso,
      timeMax: endIso,
      items: calendarIds.map((id) => ({ id })),
    },
  });
  const calendars = response.data.calendars || {};
  for (const id of calendarIds) {
    const info = (calendars as Record<string, { busy?: unknown[]; errors?: unknown[] }>)[id];
    if (!info) {
      busy.add(id); // 情報が返らないカレンダーは安全側で埋まっている扱い
      continue;
    }
    if ((info.errors || []).length > 0 || (info.busy || []).length > 0) {
      busy.add(id);
    }
  }
  return busy;
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
    visitCount?: string | null;
    preferredDate2?: string | null;
    preferredTime2?: string | null;
    preferredDate3?: string | null;
    preferredTime3?: string | null;
    selectedMenus?: Array<Record<string, any>>;
    selectedOptions?: Array<Record<string, any>>;
    gender?: string | null;
    coupon?: string | null;
    customFields?: Record<string, string> | null;
    // Google Calendar の colorId '1'〜'11'。未指定はカレンダーの既定色
    eventColorId?: string | null;
    // 担当スタッフ名（スタッフ選択機能。イベントタイトルと説明文に含める）
    staffName?: string | null;
  },
  storeId?: string
) {
  const calendar = await getCalendarClient(storeId);
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  const durationMinutes = calculateDurationMinutes(params.selectedMenus, params.selectedOptions);
  const totalPrice = calculateTotalPrice(params.selectedMenus, params.selectedOptions);
  const startDate = new Date(`${params.reservationDate}T${params.reservationTime}:00+09:00`);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const menuLines = buildMenuLines(params.selectedMenus);
  const menuText = menuLines.map(line => `・${line}`).join('\n');

  // 希望日時セクション
  const dateTimeLines = [`≪第一希望≫ ${params.reservationDate} ${params.reservationTime}`];
  if (params.preferredDate2 && params.preferredTime2) {
    dateTimeLines.push(`≪第二希望≫ ${params.preferredDate2} ${params.preferredTime2}`);
  }
  if (params.preferredDate3 && params.preferredTime3) {
    dateTimeLines.push(`≪第三希望≫ ${params.preferredDate3} ${params.preferredTime3}`);
  }

  // セクションごとに組み立て、空のセクションはスキップ
  const sections: string[] = [];
  sections.push(dateTimeLines.join('\n'));

  const customerLines = [`≪お名前≫ ${params.customerName}`];
  if (params.lineDisplayName && params.lineDisplayName !== params.customerName) {
    customerLines.push(`≪LINE名≫ ${params.lineDisplayName}`);
  }
  customerLines.push(`≪電話番号≫ ${params.customerPhone}`);
  if (params.visitCount) {
    customerLines.push(`≪ご来店回数≫ ${params.visitCount}`);
  }
  if (params.staffName) {
    customerLines.push(`≪担当スタッフ≫ ${params.staffName}`);
  }
  sections.push(customerLines.join('\n'));

  if (menuText) {
    sections.push(`≪メニュー≫\n${menuText}`);
  }

  if (params.selectedOptions && params.selectedOptions.length > 0) {
    const optionLines = params.selectedOptions.map((opt: any) => {
      const name = opt.option_name || '';
      const priceText = (opt.price || 0) > 0 ? ` ¥${Number(opt.price).toLocaleString()}` : '';
      const durationText = (opt.duration || 0) > 0 ? ` (${opt.duration}分)` : '';
      return `・${name}${priceText}${durationText}`;
    }).join('\n');
    sections.push(`≪オプション≫\n${optionLines}`);
  }

  const totalLines: string[] = [];
  if (totalPrice > 0) totalLines.push(`≪合計金額≫ ¥${totalPrice.toLocaleString()}`);
  if (durationMinutes > 0) totalLines.push(`≪合計時間≫ ${durationMinutes}分`);
  if (totalLines.length > 0) sections.push(totalLines.join('\n'));

  const extraLines: string[] = [];
  if (params.gender) extraLines.push(`≪性別≫ ${params.gender}`);
  if (params.coupon) extraLines.push(`≪クーポン≫ ${params.coupon}`);
  extraLines.push(`≪メッセージ≫ ${params.message?.trim() || 'なし'}`);
  sections.push(extraLines.join('\n'));

  if (params.customFields) {
    const customLines = Object.entries(params.customFields)
      .filter(([, value]) => value && String(value).trim())
      .map(([key, value]) => `≪${key}≫ ${value}`);
    if (customLines.length > 0) sections.push(customLines.join('\n'));
  }

  const description = sections.join('\n\n');

  const response = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: `予約: ${params.customerName}${params.staffName ? `（担当: ${params.staffName}）` : ''}`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      description,
      location: params.lineUserId || undefined,
      colorId: params.eventColorId || undefined
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
