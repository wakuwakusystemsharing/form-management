import { describe, it, expect } from 'vitest';
import { resolveReminderContent, sampleReminderContext } from '@/lib/reminder-template';
import {
  resolveFollowContent,
  sampleFollowContext,
  FOLLOW_DEFAULT_HEADER_TITLE,
  FOLLOW_DEFAULT_BODY,
  FOLLOW_DEFAULT_FOOTER,
} from '@/lib/follow-template';

describe('リマインダー文面（共通化後も既存出力が変わらない回帰テスト）', () => {
  const ctx = sampleReminderContext('サロン A', 1);

  it('未設定はデフォルト文面', () => {
    expect(resolveReminderContent(null, ctx)).toEqual({
      headerTitle: '【予約前日メッセージ】',
      headerColor: '#877059',
      textColor: '#333333',
      bodyText: '明日の予約をお知らせします',
      isCustomBody: false,
      showDetails: true,
      showFooter: true,
      footerText: '心よりお待ちしております',
    });
  });

  it('2 日前設定のデフォルト', () => {
    const r = resolveReminderContent({}, sampleReminderContext('サロン A', 2));
    expect(r.headerTitle).toBe('【予約2日前メッセージ】');
    expect(r.bodyText).toBe('2日後の予約をお知らせします');
  });

  it('カスタム値と差し込み', () => {
    const r = resolveReminderContent({
      header_title: '{店舗名}からのお知らせ',
      header_color: '#112233',
      text_color: '#445566',
      body_text: ' {LINE名}様 {予約日時} {メニュー名} {担当スタッフ} ',
      show_details: false,
      show_footer: false,
      footer_text: '無視される？いいえ、footerText には入る',
    }, ctx);
    expect(r).toEqual({
      headerTitle: 'サロン Aからのお知らせ',
      headerColor: '#112233',
      textColor: '#445566',
      bodyText: 'はなこ様 2026年04月03日（木） 10:00 カット > ロング 佐藤',
      isCustomBody: true,
      showDetails: false,
      showFooter: false,
      footerText: '無視される？いいえ、footerText には入る',
    });
  });

  it('不正な色・空白だけの本文はデフォルトに戻る', () => {
    const r = resolveReminderContent({ header_color: 'red', text_color: '#12', body_text: '   ' }, ctx);
    expect(r.headerColor).toBe('#877059');
    expect(r.textColor).toBe('#333333');
    expect(r.bodyText).toBe('明日の予約をお知らせします');
    expect(r.isCustomBody).toBe(false);
  });
});

describe('フォロー文面', () => {
  const ctx = sampleFollowContext('サロン A');

  it('未設定はフォロー用デフォルト', () => {
    const r = resolveFollowContent(null, ctx);
    expect(r.headerTitle).toBe(FOLLOW_DEFAULT_HEADER_TITLE);
    expect(r.bodyText).toBe(FOLLOW_DEFAULT_BODY);
    expect(r.footerText).toBe(FOLLOW_DEFAULT_FOOTER);
    expect(r.isCustomBody).toBe(false);
    expect(r.headerColor).toBe('#877059');
  });

  it('差し込み項目はリマインダーと同じ', () => {
    const r = resolveFollowContent({ body_text: '{お名前}様 {予約日} {店舗名}' }, ctx);
    expect(r.bodyText).toBe('山田 花子様 2026年04月03日（木） サロン A');
    expect(r.isCustomBody).toBe(true);
  });
});
