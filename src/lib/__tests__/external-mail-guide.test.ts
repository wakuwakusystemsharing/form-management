import { describe, expect, it } from 'vitest';
import { buildMailGuideSteps, buildStoreGuideText, MAIL_GUIDE_FORWARD_OPTIONS } from '../external-mail-guide';

const base = {
  hasStoreCalendar: false,
  hasInboundAddress: false,
  enabledSaved: false,
  hasCreatedLog: false,
  hasGmailForwardingLog: false,
};

describe('external-mail-guide: 進み具合', () => {
  it('何もしていないときは手順 1 が「いま」で、以降は未着手', () => {
    const steps = buildMailGuideSteps(base);
    expect(steps.map((s) => s.status)).toEqual(['current', 'todo', 'todo', 'done', 'todo']);
    expect(steps[0].key).toBe('calendar');
  });
  it('カレンダー設定済み → 手順 2 が「いま」', () => {
    const steps = buildMailGuideSteps({ ...base, hasStoreCalendar: true });
    expect(steps.map((s) => s.status)).toEqual(['done', 'current', 'todo', 'done', 'todo']);
  });
  it('ON で保存済み → 転送設定が「いま」。Gmail の確認メールが来ていれば案内を足す', () => {
    const steps = buildMailGuideSteps({ ...base, hasStoreCalendar: true, hasInboundAddress: true, enabledSaved: true, hasGmailForwardingLog: true });
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'current', 'done', 'todo']);
    expect(steps[2].lines.join('')).toContain('Gmail転送の確認メール');
  });
  it('アドレスはあるが OFF で保存されていれば手順 2 は未完了', () => {
    const steps = buildMailGuideSteps({ ...base, hasStoreCalendar: true, hasInboundAddress: true, enabledSaved: false });
    expect(steps[1].status).toBe('current');
  });
  it('登録済みのログがあれば全部 done', () => {
    const steps = buildMailGuideSteps({ hasStoreCalendar: true, hasInboundAddress: true, enabledSaved: true, hasCreatedLog: true, hasGmailForwardingLog: false });
    expect(steps.every((s) => s.status === 'done')).toBe(true);
  });
  it('転送方法は A（Gmail）と B（媒体の通知先）の 2 つ', () => {
    expect(MAIL_GUIDE_FORWARD_OPTIONS).toHaveLength(2);
    expect(MAIL_GUIDE_FORWARD_OPTIONS[0].title).toContain('Gmail');
  });
});

describe('external-mail-guide: 店舗への案内文', () => {
  it('店舗名と受信アドレスを含む', () => {
    const text = buildStoreGuideText('テスト店', 'rsv-abc123@example.resend.app');
    expect(text).toContain('テスト店 ご担当者様');
    expect(text).toContain('rsv-abc123@example.resend.app');
    expect(text).toContain('メール転送と POP/IMAP');
  });
  it('アドレス未発行なら発行方法を書く', () => {
    const text = buildStoreGuideText('', null);
    expect(text).toContain('連携を ON にして保存すると発行されます');
    expect(text.startsWith('ご担当者様')).toBe(true);
  });
});
