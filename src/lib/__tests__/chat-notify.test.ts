/**
 * 1 対 1 トーク: 新着の通知と自動削除の純粋ロジック
 */
import { describe, expect, it } from 'vitest';
import {
  CHAT_NOTIFY_DEFAULTS,
  buildChatAdminUrl,
  buildChatNotifyEmail,
  buildChatNotifyLineText,
  canNotifyChatThread,
  chatNotifySettingsToRow,
  chatNotifySkipReason,
  chatRetentionCutoff,
  isChatQuietTime,
  normalizeChatNotifySettings,
  validateChatNotifySettings,
} from '@/lib/chat-notify';

const jst = (s: string) => new Date(`${s}+09:00`);

describe('通知の設定', () => {
  it('既定は OFF・夜間（22〜8 時）は送らない。列が無い環境・読めない値も既定', () => {
    expect(normalizeChatNotifySettings(null)).toEqual(CHAT_NOTIFY_DEFAULTS);
    expect(normalizeChatNotifySettings({ enabled: true, retention_years: 1 })).toEqual(CHAT_NOTIFY_DEFAULTS);
    expect(normalizeChatNotifySettings({ notify_line: 'yes', notify_emails: 'a@example.com', notify_quiet_start: 30 })).toEqual(CHAT_NOTIFY_DEFAULTS);
  });

  it('保存した行を読み直すと、同じ設定になる', () => {
    const s = { line: true, email: true, emails: ['a@example.com', 'b@example.com'], quiet: { enabled: false, start: 0, end: 6 } };
    expect(normalizeChatNotifySettings(chatNotifySettingsToRow(s))).toEqual(s);
  });

  it('検証: メールは 5 件まで・形が正しい・ON にするなら 1 件以上', () => {
    expect(validateChatNotifySettings({ line: true, email: false, emails: [], quiet: { enabled: true, start: 22, end: 8 } })).toEqual({ ok: true, value: { line: true, email: false, emails: [], quiet: { enabled: true, start: 22, end: 8 } } });
    // 重複と空行は取り除く
    const ok = validateChatNotifySettings({ email: true, emails: [' a@example.com ', 'a@example.com', '', 'b@example.com'] });
    expect(ok.ok && ok.value.emails).toEqual(['a@example.com', 'b@example.com']);
    expect(validateChatNotifySettings({ email: true, emails: [] }).ok).toBe(false);
    expect(validateChatNotifySettings({ email: true, emails: ['abc'] }).ok).toBe(false);
    expect(validateChatNotifySettings({ email: true, emails: Array.from({ length: 6 }, (_, i) => `s${i}@example.com`) }).ok).toBe(false);
    expect(validateChatNotifySettings({ line: true, quiet: { enabled: true, start: 24, end: 8 } }).ok).toBe(false);
    expect(validateChatNotifySettings(null).ok).toBe(false);
  });
});

describe('送るかどうか', () => {
  it('夜間（日本時間。日付をまたぐ時間帯）は送らない', () => {
    const q = { enabled: true, start: 22, end: 8 };
    expect(isChatQuietTime(q, jst('2026-11-25T21:59:00'))).toBe(false);
    expect(isChatQuietTime(q, jst('2026-11-25T22:00:00'))).toBe(true);
    expect(isChatQuietTime(q, jst('2026-11-26T03:00:00'))).toBe(true);
    expect(isChatQuietTime(q, jst('2026-11-26T07:59:00'))).toBe(true);
    expect(isChatQuietTime(q, jst('2026-11-26T08:00:00'))).toBe(false);
    // 日付をまたがない時間帯・OFF・始まりと終わりが同じ
    expect(isChatQuietTime({ enabled: true, start: 1, end: 5 }, jst('2026-11-26T03:00:00'))).toBe(true);
    expect(isChatQuietTime({ enabled: true, start: 1, end: 5 }, jst('2026-11-26T06:00:00'))).toBe(false);
    expect(isChatQuietTime({ enabled: false, start: 22, end: 8 }, jst('2026-11-26T03:00:00'))).toBe(false);
    expect(isChatQuietTime({ enabled: true, start: 8, end: 8 }, jst('2026-11-26T08:00:00'))).toBe(false);
  });

  it('送り先が無ければ off、夜間は quiet', () => {
    const noon = jst('2026-11-25T12:00:00');
    const night = jst('2026-11-25T23:00:00');
    expect(chatNotifySkipReason(CHAT_NOTIFY_DEFAULTS, noon)).toBe('off');
    // メールが ON でも、宛先が無ければ送らない
    expect(chatNotifySkipReason({ ...CHAT_NOTIFY_DEFAULTS, email: true }, noon)).toBe('off');
    expect(chatNotifySkipReason({ ...CHAT_NOTIFY_DEFAULTS, line: true }, noon)).toBeNull();
    expect(chatNotifySkipReason({ ...CHAT_NOTIFY_DEFAULTS, line: true }, night)).toBe('quiet');
    expect(chatNotifySkipReason({ ...CHAT_NOTIFY_DEFAULTS, email: true, emails: ['a@example.com'], quiet: { enabled: false, start: 22, end: 8 } }, night)).toBeNull();
  });

  it('同じ会話については 10 分に 1 回まで', () => {
    const now = new Date('2026-11-25T03:10:00Z');
    expect(canNotifyChatThread(null, now)).toBe(true);
    expect(canNotifyChatThread('2026-11-25T03:00:01Z', now)).toBe(false);
    expect(canNotifyChatThread('2026-11-25T03:00:00Z', now)).toBe(true);
    expect(canNotifyChatThread('2026-11-25T02:00:00Z', now)).toBe(true);
  });
});

describe('通知の文', () => {
  const content = { storeName: 'テスト店', customerName: '山田 花子', unread: 3, url: 'https://app.example/abc123/admin?tab=chat' };

  it('名前・未読の数・管理画面のリンクを出す', () => {
    const text = buildChatNotifyLineText(content);
    expect(text).toContain('山田 花子 様から新しいメッセージが届きました（未読 3 件）');
    expect(text).toContain('https://app.example/abc123/admin?tab=chat');
    const mail = buildChatNotifyEmail(content);
    expect(mail.subject).toBe('【テスト店】山田 花子 様から新しいメッセージが届きました');
    expect(mail.body).toContain('https://app.example/abc123/admin?tab=chat');
    expect(mail.body).toContain('メッセージの内容は載せていません');
  });

  it('名前が分からない人は「お客様」。未読が 1 件のときは数を出さない', () => {
    const text = buildChatNotifyLineText({ ...content, customerName: '', unread: 1 });
    expect(text).toContain('【トーク】お客様から新しいメッセージが届きました\n');
    expect(text).not.toContain('未読');
  });

  it('管理画面の URL は、店舗管理者ページのトークのタブ', () => {
    expect(buildChatAdminUrl('https://nas-rsv.com/', 'l9ksjl')).toBe('https://nas-rsv.com/l9ksjl/admin?tab=chat');
  });
});

describe('自動削除', () => {
  it('保存期間は暦の年で引く', () => {
    const now = new Date('2027-11-25T03:00:00.000Z');
    expect(chatRetentionCutoff(1, now)).toBe('2026-11-25T03:00:00.000Z');
    expect(chatRetentionCutoff(2, now)).toBe('2025-11-25T03:00:00.000Z');
    expect(chatRetentionCutoff(3, now)).toBe('2024-11-25T03:00:00.000Z');
  });
});
