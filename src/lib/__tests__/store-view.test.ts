import { describe, it, expect } from 'vitest';
import { PUBLIC_STORE_KEYS, sanitizeStoreUpdate, toStoreView } from '../store-view';

const STORE = {
  id: 'abc123',
  org_id: 'org-1',
  name: 'テスト店',
  logo_url: 'https://cdn/logo.png',
  theme_color: '#ff8800',
  owner_name: '山田',
  owner_email: 'owner@example.com',
  phone: '03-0000-0000',
  address: '東京都',
  line_channel_access_token: 'LINE-TOKEN',
  google_calendar_id: 'cal@example.com',
  google_calendar_refresh_token: 'GOOGLE-REFRESH',
  admin_visible_tabs: ['dashboard', 'reservations'],
  reminder_enabled: true,
};

describe('店舗情報の出し分け', () => {
  it('ログインしていない人には、店舗名・ロゴ・テーマカラーだけ', () => {
    const view = toStoreView(STORE, 'public');
    expect(view).toEqual({ id: 'abc123', name: 'テスト店', logo_url: 'https://cdn/logo.png', theme_color: '#ff8800' });
    expect(Object.keys(view).sort()).toEqual([...PUBLIC_STORE_KEYS].sort());
    const text = JSON.stringify(view);
    for (const secret of ['LINE-TOKEN', 'GOOGLE-REFRESH', 'owner@example.com', '03-0000-0000', '山田']) expect(text).not.toContain(secret);
  });

  it('店舗管理者には鍵を返さず、設定済みかどうかだけ返す', () => {
    const view = toStoreView(STORE, 'store');
    expect(view.line_channel_access_token).toBeUndefined();
    expect(view.line_channel_access_token_set).toBe(true);
    expect(view.google_calendar_refresh_token).toBeUndefined();
    // 画面に必要な項目はそのまま
    expect(view).toMatchObject({ id: 'abc123', name: 'テスト店', owner_name: '山田', admin_visible_tabs: ['dashboard', 'reservations'], reminder_enabled: true, google_calendar_id: 'cal@example.com' });
    expect(JSON.stringify(view)).not.toContain('LINE-TOKEN');
    expect(JSON.stringify(view)).not.toContain('GOOGLE-REFRESH');
    // 未設定なら false
    expect(toStoreView({ ...STORE, line_channel_access_token: '  ' }, 'store').line_channel_access_token_set).toBe(false);
    expect(toStoreView({ id: 'x', name: 'y' }, 'store').line_channel_access_token_set).toBe(false);
  });

  it('運営には店舗編集に必要な項目を返す。Google の鍵は誰にも返さない', () => {
    const view = toStoreView(STORE, 'upper');
    expect(view.line_channel_access_token).toBe('LINE-TOKEN');
    expect(view.google_calendar_refresh_token).toBeUndefined();
    expect(view.org_id).toBe('org-1');
    expect(JSON.stringify(view)).not.toContain('GOOGLE-REFRESH');
  });

  it('元のデータは書き換えない。空の入力でも落ちない', () => {
    toStoreView(STORE, 'store');
    toStoreView(STORE, 'public');
    expect(STORE.line_channel_access_token).toBe('LINE-TOKEN');
    expect(STORE.google_calendar_refresh_token).toBe('GOOGLE-REFRESH');
    expect(toStoreView(null, 'public')).toEqual({});
    expect(toStoreView(undefined, 'upper')).toEqual({});
  });
});

describe('更新で反映しない項目', () => {
  it('ID・作成日時・連携の鍵・表示用の項目は取り除く', () => {
    const out = sanitizeStoreUpdate({ id: 'zzz', created_at: 'x', name: '新しい名前', google_calendar_refresh_token: 'attack', line_channel_access_token_set: true, line_channel_access_token: 'NEW' }, { isMaster: true });
    expect(out).toEqual({ name: '新しい名前', line_channel_access_token: 'NEW' });
  });

  it('テナントの付け替え（org_id）はマスター管理者だけ', () => {
    expect(sanitizeStoreUpdate({ name: 'a', org_id: 'org-2' }, { isMaster: false })).toEqual({ name: 'a' });
    expect(sanitizeStoreUpdate({ name: 'a', org_id: 'org-2' }, { isMaster: true })).toEqual({ name: 'a', org_id: 'org-2' });
  });

  it('空・おかしな入力でも落ちない', () => {
    expect(sanitizeStoreUpdate(null, { isMaster: false })).toEqual({});
    expect(sanitizeStoreUpdate(undefined, { isMaster: true })).toEqual({});
  });
});
