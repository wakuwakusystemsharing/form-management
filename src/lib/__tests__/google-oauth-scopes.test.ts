import { describe, it, expect } from 'vitest';
import { GOOGLE_CALENDAR_OAUTH_SCOPES } from '../google-oauth-scopes';

// Google OAuth 審査（最小スコープ要件）で Cloud Console の「データアクセス」に登録した
// スコープと完全一致させる必要がある。変更する場合は Console 側も同時に更新すること。
describe('GOOGLE_CALENDAR_OAUTH_SCOPES', () => {
  it('店舗 OAuth で使う最小スコープのみを要求する', () => {
    expect([...GOOGLE_CALENDAR_OAUTH_SCOPES].sort()).toEqual(
      [
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
      ].sort()
    );
  });

  it('フルアクセスの calendar / calendar.acls スコープを含まない', () => {
    expect(GOOGLE_CALENDAR_OAUTH_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
    expect(GOOGLE_CALENDAR_OAUTH_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar.acls');
  });
});
