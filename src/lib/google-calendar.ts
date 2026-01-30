import { google } from 'googleapis';
import { createAdminClient } from './supabase';

const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];

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

  const { data, error } = await adminClient
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

async function getCalendarClient() {
  const rawJson = await getServiceAccountJson();
  if (!rawJson) return null;

  const credentials = parseServiceAccountJson(rawJson);
  if (!credentials?.client_email || !credentials?.private_key) {
    console.error('[GoogleCalendar] Invalid service account JSON');
    return null;
  }

  const auth = new google.auth.JWT(
    credentials.client_email,
    undefined,
    credentials.private_key,
    GOOGLE_CALENDAR_SCOPES
  );

  return google.calendar({ version: 'v3', auth });
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

export async function createStoreCalendar(storeName: string) {
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

  return response.data.id || null;
}

export async function listCalendarEvents(calendarId: string, startIso: string, endIso: string) {
  const calendar = await getCalendarClient();
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

export async function createReservationEvent(params: {
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
}) {
  const calendar = await getCalendarClient();
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

export async function deleteCalendarEvent(calendarId: string, eventId: string) {
  const calendar = await getCalendarClient();
  if (!calendar) {
    throw new Error('Google Calendar APIの認証情報が設定されていません');
  }

  await calendar.events.delete({
    calendarId,
    eventId
  });
}
