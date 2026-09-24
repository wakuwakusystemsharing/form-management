/**
 * 店舗 OAuth（store_oauth）で Google に要求するスコープ。
 *
 * Google OAuth 審査の「最小スコープ」要件により、Cloud Console の
 * 「Google Auth Platform > データアクセス」に登録したスコープと完全一致させる必要がある。
 * 変更する場合は Console 側とプライバシーポリシー（/privacy の 10.1）も同時に更新すること。
 *
 * - calendar.events: 予約イベントの作成・変更・削除、空き枠計算のための events.list
 * - calendar.calendarlist.readonly: 予約反映先カレンダーを選ばせるための calendarList.list
 * - calendar.events.freebusy: スタッフカレンダーの二重予約防止のための freebusy.query
 *
 * カレンダー作成・共有（calendars.insert / acl.insert）はサービスアカウントのみで行うため不要。
 */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];
