/**
 * 1 対 1 トークの純粋ロジック（設定・届いたメッセージの形・「自動」の印）
 */
import { describe, expect, it } from 'vitest';
import {
  CHAT_DEFAULT_SETTINGS,
  CHAT_POLL_MAX_MS,
  CHAT_POLL_MIN_MS,
  CHAT_UNKNOWN_NAME,
  buildChatPreview,
  chatDisplayName,
  chatEnableBlocker,
  decideResend,
  describeChatSendError,
  matchesChatSearch,
  nextChatPollDelay,
  normalizeClientKey,
  sortChatThreads,
  stickerImageUrl,
  toChatMessageView,
  validateChatReply,
  classifyAutoMessage,
  isFormFollowUp,
  normalizeChatSettings,
  toChatInbound,
  validateChatSettingsInput,
} from '@/lib/chat';

describe('トークの設定', () => {
  it('既定は OFF・保存期間 1 年。読めない値は既定にする', () => {
    expect(normalizeChatSettings(null)).toEqual(CHAT_DEFAULT_SETTINGS);
    expect(normalizeChatSettings({ enabled: 'true', retention_years: 5 })).toEqual(CHAT_DEFAULT_SETTINGS);
    expect(normalizeChatSettings({ enabled: true, retention_years: 3, enabled_at: '2026-11-25T00:00:00Z' })).toMatchObject({ enabled: true, retention_years: 3, enabled_at: '2026-11-25T00:00:00Z' });
  });

  it('指定した項目だけを変え、選べない保存期間は断る', () => {
    const current = { ...CHAT_DEFAULT_SETTINGS, enabled: true, retention_years: 2 as const };
    expect(validateChatSettingsInput({ retention_years: 3 }, current)).toEqual({ ok: true, value: { enabled: true, retention_years: 3 } });
    expect(validateChatSettingsInput({ enabled: false }, current)).toEqual({ ok: true, value: { enabled: false, retention_years: 2 } });
    expect(validateChatSettingsInput({ retention_years: 4 }, current).ok).toBe(false);
    expect(validateChatSettingsInput({ enabled: 'yes' }, current).ok).toBe(false);
    expect(validateChatSettingsInput(null, current).ok).toBe(false);
  });

  it('チャネルシークレットを登録した店舗だけ ON にできる（local は制限なし）', () => {
    expect(chatEnableBlocker({ secretSet: true })).toBeNull();
    expect(chatEnableBlocker({ secretSet: false })).toContain('チャネルシークレット');
    expect(chatEnableBlocker({ secretSet: false, local: true })).toBeNull();
    expect(chatEnableBlocker({ secretSet: true, tableMissing: true })).toContain('マイグレーション');
  });
});

describe('届いた通知を保存する形にする', () => {
  const base = { type: 'message', timestamp: Date.parse('2026-11-25T03:00:00Z'), source: { type: 'user', userId: 'U1' } };

  it('文字はそのまま、日時は LINE の通知の日時', () => {
    expect(toChatInbound({ ...base, message: { id: 'm1', type: 'text', text: 'こんにちは' } })).toEqual({
      lineUserId: 'U1',
      lineMessageId: 'm1',
      kind: 'text',
      text: 'こんにちは',
      meta: null,
      at: '2026-11-25T03:00:00.000Z',
    });
  });

  it('スタンプは番号だけ、動画などは種類だけを持つ（中身は持たない）', () => {
    expect(toChatInbound({ ...base, message: { id: 'm2', type: 'sticker', packageId: '446', stickerId: '1988' } })).toMatchObject({ kind: 'sticker', text: null, meta: { sticker_id: '1988', package_id: '446' } });
    expect(toChatInbound({ ...base, message: { id: 'm3', type: 'video' } })).toMatchObject({ kind: 'video', text: null, meta: null });
    expect(toChatInbound({ ...base, message: { id: 'm4', type: 'image' } })).toMatchObject({ kind: 'image' });
    expect(toChatInbound({ ...base, message: { id: 'm5', type: 'unknown-new-type' } })).toMatchObject({ kind: 'other' });
  });

  it('グループ・メッセージ以外・ID の無いものは保存しない', () => {
    expect(toChatInbound({ ...base, source: { type: 'group', userId: 'U1', groupId: 'G1' }, message: { id: 'm1', type: 'text', text: 'a' } })).toBeNull();
    expect(toChatInbound({ ...base, source: { type: 'room', userId: 'U1' }, message: { id: 'm1', type: 'text', text: 'a' } })).toBeNull();
    expect(toChatInbound({ ...base, type: 'follow' })).toBeNull();
    expect(toChatInbound({ ...base, type: 'postback', postback: { data: 'x' } })).toBeNull();
    expect(toChatInbound({ ...base, message: { type: 'text', text: 'a' } })).toBeNull();
    expect(toChatInbound({ ...base, source: { type: 'user' }, message: { id: 'm1', type: 'text', text: 'a' } })).toBeNull();
    expect(toChatInbound(null)).toBeNull();
  });

  it('5000 文字を超える文は切る', () => {
    expect(toChatInbound({ ...base, message: { id: 'm1', type: 'text', text: 'あ'.repeat(6000) } })?.text).toHaveLength(5000);
  });

  it('一覧の 1 行: 改行をつめて 60 文字まで。文字以外は種類を出す', () => {
    expect(buildChatPreview('text', '明日の\n予約ですが')).toBe('明日の 予約ですが');
    expect(buildChatPreview('text', 'あ'.repeat(80))).toBe(`${'あ'.repeat(60)}…`);
    expect(buildChatPreview('image', null)).toBe('画像が送られました');
    expect(buildChatPreview('video', null)).toBe('動画が送られました');
  });
});

describe('「自動」の印', () => {
  it('フォームの送信文（1 行目が【…】）', () => {
    expect(classifyAutoMessage('【カット予約フォーム】\n《お名前》\n山田')).toBe('form');
    expect(classifyAutoMessage('【空き待ち登録】\n《ご希望の日時》\n2026年11月30日 10:00')).toBe('form');
    expect(classifyAutoMessage('【メニュー変更】\n《変更後のメニュー》\nカット')).toBe('form');
  });

  it('コマンド（予約確認・予約を変更・キャンセル: 3 など）', () => {
    for (const t of ['予約確認', '予約をキャンセル', '予約を変更', '空き待ち確認', 'キャンセル: 3', 'キャンセル確定: 12', 'スタッフ登録 4821', 'スタッフ登録解除', ' 予約確認 ']) {
      expect(classifyAutoMessage(t), t).toBe('command');
    }
  });

  it('店舗の配信停止の合言葉・キーワード自動応答の合言葉', () => {
    expect(classifyAutoMessage('配信停止')).toBeNull();
    expect(classifyAutoMessage('配信停止', { optKeywords: ['配信停止', '配信再開'] })).toBe('command');
    expect(classifyAutoMessage('メニュー', { keywords: ['メニュー', '料金'] })).toBe('keyword');
    expect(classifyAutoMessage('メニューを教えてください', { keywords: ['メニュー'] })).toBeNull();
  });

  it('お客様が手で書いた文には印を付けない', () => {
    for (const t of ['こんにちは', '予約確認したいです', '明日の予約をキャンセルしたいのですが', '駐車場はありますか？【至急】', '']) {
      expect(classifyAutoMessage(t), t).toBeNull();
    }
    expect(classifyAutoMessage(null)).toBeNull();
  });

  it('フォームの送信文の 3 秒以内に続いた文は、フォームが続けて送った文', () => {
    const at = '2026-11-25T03:00:00.000Z';
    expect(isFormFollowUp({ autoKind: 'form', at }, '2026-11-25T03:00:00.400Z')).toBe(true);
    expect(isFormFollowUp({ autoKind: 'follow_up', at }, '2026-11-25T03:00:02.000Z')).toBe(true);
    // 通知の順番が入れ替わって、少し前の日時で届いても同じ
    expect(isFormFollowUp({ autoKind: 'form', at }, '2026-11-25T02:59:59.800Z')).toBe(true);
    expect(isFormFollowUp({ autoKind: 'form', at }, '2026-11-25T03:00:10.000Z')).toBe(false);
    expect(isFormFollowUp({ autoKind: 'command', at }, '2026-11-25T03:00:00.400Z')).toBe(false);
    expect(isFormFollowUp({ autoKind: null, at }, '2026-11-25T03:00:00.400Z')).toBe(false);
    expect(isFormFollowUp(null, at)).toBe(false);
  });
});

describe('画面に出す形', () => {
  it('一覧は未読のある会話が上、その中は新しい順', () => {
    const t = (id: string, unread: number, at: string) => ({ id, unread_count: unread, last_message_at: at });
    const sorted = sortChatThreads([t('a', 0, '2026-11-25T05:00:00Z'), t('b', 2, '2026-11-25T01:00:00Z'), t('c', 0, '2026-11-25T06:00:00Z'), t('d', 1, '2026-11-25T03:00:00Z')]);
    expect(sorted.map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('名前の無い人は「（お名前不明）」。検索は大文字小文字を区別しない', () => {
    expect(chatDisplayName(' 山田 ')).toBe('山田');
    expect(chatDisplayName(null)).toBe(CHAT_UNKNOWN_NAME);
    expect(matchesChatSearch('Yamada 太郎', 'yama')).toBe(true);
    expect(matchesChatSearch('山田', '佐藤')).toBe(false);
    expect(matchesChatSearch('山田', '  ')).toBe(true);
  });

  it('スタンプは番号が数字のときだけ画像にする。返信した人の名前を出す', () => {
    expect(stickerImageUrl({ sticker_id: '1988' })).toBe('https://stickershop.line-scdn.net/stickershop/v1/sticker/1988/android/sticker.png');
    expect(stickerImageUrl({ sticker_id: '../x' })).toBeNull();
    expect(stickerImageUrl(null)).toBeNull();
    const view = toChatMessageView({
      id: '7',
      thread_id: 't',
      store_id: 's',
      direction: 'out',
      kind: 'text',
      text: 'ありがとうございます',
      meta: { sent_by_name: 'staff@example.com' },
      media_path: null,
      auto: false,
      auto_kind: null,
      line_message_id: null,
      client_key: 'k',
      send_status: 'sent',
      send_error: null,
      sent_by: 'u1',
      created_at: '2026-11-25T03:00:00.000Z',
    });
    expect(view).toMatchObject({ id: '7', direction: 'out', sent_by_name: 'staff@example.com', send_status: 'sent', sticker_url: null });
    // 画面に返す形には、送信の ID・スタッフの ID を入れない
    expect(Object.keys(view)).not.toEqual(expect.arrayContaining(['client_key', 'sent_by', 'line_message_id', 'store_id']));
  });
});

describe('返信', () => {
  const KEY = '3f2b8c1e-6a4d-4f7b-9c2a-1d5e8f0a7b3c';

  it('空の文・5000 文字を超える文・形のおかしい送信の ID は断る', () => {
    expect(validateChatReply({ text: '  ありがとうございます\r\nまたお待ちしています ', client_key: KEY })).toEqual({ ok: true, text: 'ありがとうございます\nまたお待ちしています', clientKey: KEY });
    expect(validateChatReply({ text: '   ', client_key: KEY }).ok).toBe(false);
    expect(validateChatReply({ text: 'あ'.repeat(5001), client_key: KEY }).ok).toBe(false);
    expect(validateChatReply({ text: 'あ'.repeat(5000), client_key: KEY }).ok).toBe(true);
    expect(validateChatReply({ text: 'こんにちは', client_key: 'abc' }).ok).toBe(false);
    expect(validateChatReply({ text: 'こんにちは' }).ok).toBe(false);
    expect(validateChatReply(null).ok).toBe(false);
    expect(normalizeClientKey(KEY.toUpperCase())).toBe(KEY);
  });

  it('同じ送信の ID が届いたとき: 送信済みは送らない / 送信中は待つ / 失敗・止まったものは送り直す', () => {
    const now = new Date('2026-11-25T03:00:40Z');
    expect(decideResend({ send_status: 'sent', created_at: '2026-11-25T03:00:00Z' }, now)).toBe('done');
    expect(decideResend({ send_status: 'failed', created_at: '2026-11-25T03:00:00Z' }, now)).toBe('resend');
    expect(decideResend({ send_status: 'sending', created_at: '2026-11-25T03:00:30Z' }, now)).toBe('wait');
    expect(decideResend({ send_status: 'sending', created_at: '2026-11-25T03:00:00Z' }, now)).toBe('resend');
  });

  it('送れなかった理由を、分かる言葉にする', () => {
    expect(describeChatSendError(401, '')).toContain('チャネルアクセストークン');
    expect(describeChatSendError(429, '{"message":"You have reached your monthly limit."}')).toBe('今月の通数の上限に達しています');
    expect(describeChatSendError(429, '{"message":"Too many requests"}')).toContain('混み合って');
    expect(describeChatSendError(400, '{"message":"Failed to send messages"}')).toContain('ブロック');
    expect(describeChatSendError(0, 'aborted')).toContain('通信できません');
    expect(describeChatSendError(503, '')).toContain('LINE 側');
  });
});

describe('新着の確認の間隔', () => {
  it('新着があれば 15 秒、無い間は 30 秒まで少しずつ延ばす', () => {
    expect(nextChatPollDelay(CHAT_POLL_MAX_MS, true)).toBe(CHAT_POLL_MIN_MS);
    let d = CHAT_POLL_MIN_MS;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      d = nextChatPollDelay(d, false);
      seen.push(d);
    }
    expect(seen).toEqual([20000, 25000, 30000, 30000, 30000]);
  });
});
