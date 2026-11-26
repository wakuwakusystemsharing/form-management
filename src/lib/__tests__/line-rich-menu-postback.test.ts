/**
 * リッチメニュー: トークに文字を出さずに動くボタン（postback）
 */
import { describe, expect, it } from 'vitest';
import {
  RICH_MENU_KEYWORDS,
  RICH_MENU_LIMITS,
  buildRichMenuCommandData,
  buildRichMenuObject,
  buildRichMenuReplyData,
  describeRichMenuAction,
  normalizeRichMenuAction,
  parseRichMenuPostback,
  validateRichMenu,
  type RichMenuArea,
  type RichMenuInput,
} from '@/lib/line-rich-menu';

const area = (id: string, x: number, action: RichMenuArea['action']): RichMenuArea => ({ id, x, y: 0, w: 0.25, h: 1, action });
const input = (areas: RichMenuArea[]): RichMenuInput => ({ name: 'メニュー', size: 'small', image_url: 'https://example.com/a.jpg', areas, chat_bar_text: 'メニュー', open_by_default: true, rule: null });
const noForm = () => null;

describe('予約語', () => {
  it('Webhook が受け取る言葉と同じ（キャンセルは「予約をキャンセル」）', () => {
    expect(RICH_MENU_KEYWORDS.map((k) => k.text)).toEqual(['予約確認', '予約を変更', '予約をキャンセル', '空き待ち確認']);
  });

  it('前の「キャンセル」で保存したボタンは、読むときに「予約をキャンセル」に直す', () => {
    expect(normalizeRichMenuAction({ type: 'message', text: 'キャンセル' })).toEqual({ type: 'message', text: '予約をキャンセル' });
    expect(normalizeRichMenuAction({ type: 'message', text: 'キャンセルしたい' })).toEqual({ type: 'message', text: 'キャンセルしたい' });
  });
});

describe('正規化', () => {
  it('文字を出さない設定は true のときだけ持つ', () => {
    expect(normalizeRichMenuAction({ type: 'message', text: ' 予約確認 ', silent: true })).toEqual({ type: 'message', text: '予約確認', silent: true });
    expect(normalizeRichMenuAction({ type: 'message', text: '予約確認', silent: 'yes' })).toEqual({ type: 'message', text: '予約確認' });
  });

  it('応答メッセージ: 返し方は text / message だけ', () => {
    expect(normalizeRichMenuAction({ type: 'reply', mode: 'message', message_id: ' abc ', text: 1 })).toEqual({ type: 'reply', mode: 'message', text: '', message_id: 'abc' });
    expect(normalizeRichMenuAction({ type: 'reply', mode: 'x', text: ' こんにちは ' })).toEqual({ type: 'reply', mode: 'text', text: 'こんにちは', message_id: '' });
  });
});

describe('反映のときの確認', () => {
  const publish = (action: RichMenuArea['action'], messageIds: string[] | null = ['m1']) => validateRichMenu(input([area('a1', 0, action)]), { forPublish: true, messageIds });

  it('応答メッセージ: 文章が空・長すぎる・LINE メッセージが未選択・消えている', () => {
    expect(publish({ type: 'reply', mode: 'text', text: '', message_id: '' })).toEqual(['ボタン 1: 返す文章を入力してください']);
    expect(publish({ type: 'reply', mode: 'text', text: 'あ'.repeat(RICH_MENU_LIMITS.replyTextMax + 1), message_id: '' })[0]).toContain('長すぎます');
    expect(publish({ type: 'reply', mode: 'message', text: '', message_id: '' })).toEqual(['ボタン 1: 返す LINE メッセージを選んでください']);
    expect(publish({ type: 'reply', mode: 'message', text: '', message_id: 'gone' })[0]).toContain('見つかりません');
    expect(publish({ type: 'reply', mode: 'message', text: '', message_id: 'm1' })).toEqual([]);
    expect(publish({ type: 'reply', mode: 'text', text: '営業時間は 10 時からです', message_id: '' })).toEqual([]);
  });

  it('下書きの保存では、応答メッセージが未入力でも保存できる', () => {
    expect(validateRichMenu(input([area('a1', 0, { type: 'reply', mode: 'text', text: '', message_id: '' })]))).toEqual([]);
  });
});

describe('LINE に送る形', () => {
  it('文字を出さないボタンは postback にし、displayText を付けない（トークに何も出ない）', () => {
    const r = buildRichMenuObject(input([area('a1', 0, { type: 'message', text: '予約確認', silent: true }), area('a2', 0.25, { type: 'message', text: '予約確認' })]), noForm);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const actions = (r.object.areas as Array<{ action: Record<string, unknown> }>).map((a) => a.action);
    expect(actions[0]).toEqual({ type: 'postback', label: '予約確認', data: 'rmc:予約確認' });
    expect(actions[0]).not.toHaveProperty('displayText');
    expect(actions[1]).toEqual({ type: 'message', label: '予約確認', text: '予約確認' });
  });

  it('応答メッセージのボタンは、メニューとボタンの ID を data に入れる', () => {
    const menuId = '3f2b6c1e-0a4d-4f6e-9b1a-7c5d2e8f9a10';
    const r = buildRichMenuObject(input([area('a1', 0, { type: 'reply', mode: 'text', text: 'こんにちは', message_id: '' })]), noForm, undefined, { menuId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const action = (r.object.areas as Array<{ action: Record<string, unknown> }>)[0].action;
    expect(action).toEqual({ type: 'postback', label: 'ボタン 1', data: `rma:${menuId}:a1` });
    // 返す文章そのものは LINE に預けない（押されたときに、保存済みのメニューから読む）
    expect(JSON.stringify(r.object)).not.toContain('こんにちは');
    expect(String(action.data).length).toBeLessThanOrEqual(300);
  });

  it('メニューの ID が無いと、応答メッセージのボタンは作れない', () => {
    const r = buildRichMenuObject(input([area('a1', 0, { type: 'reply', mode: 'text', text: 'こんにちは', message_id: '' })]), noForm);
    expect(r).toMatchObject({ ok: false });
  });
});

describe('押されたときの data を読む', () => {
  it('文字を出さないボタン・応答メッセージのボタン', () => {
    expect(parseRichMenuPostback(buildRichMenuCommandData('予約をキャンセル'))).toEqual({ kind: 'command', text: '予約をキャンセル' });
    expect(parseRichMenuPostback(buildRichMenuReplyData('menu-1', 'a2'))).toEqual({ kind: 'reply', menuId: 'menu-1', areaId: 'a2' });
  });

  it('ほかのボタンの data は対象外（切り替え・予約変更・分岐・空き待ち）', () => {
    for (const data of ['rm:switch:nasrsv-abc', 'rc:d:123', 'lf:abc:b1', 'wl:x:1', '', 'rmc:', 'rma:menu-1', 'rma:menu 1:a1', "rma:x:a1';drop"]) {
      expect(parseRichMenuPostback(data)).toBeNull();
    }
    expect(parseRichMenuPostback(undefined)).toBeNull();
  });
});

describe('一覧・プレビューの説明', () => {
  const name = (id: string) => (id === 'm1' ? '営業案内カード' : null);
  it('動きを言葉にする', () => {
    expect(describeRichMenuAction({ type: 'message', text: '予約確認', silent: true }, () => null)).toBe('「予約確認」の返事を返す（トークに文字を出さない）');
    expect(describeRichMenuAction({ type: 'reply', mode: 'text', text: '営業時間は 10 時からです', message_id: '' }, () => null)).toBe('応答メッセージを返す: 営業時間は 10 時からです');
    expect(describeRichMenuAction({ type: 'reply', mode: 'message', text: '', message_id: 'm1' }, () => null, () => null, name)).toBe('応答メッセージを返す: 営業案内カード');
    expect(describeRichMenuAction({ type: 'reply', mode: 'message', text: '', message_id: 'x' }, () => null, () => null, name)).toBe('応答メッセージを返す: （削除された LINE メッセージ）');
    expect(describeRichMenuAction({ type: 'reply', mode: 'text', text: '', message_id: '' }, () => null)).toBe('応答メッセージを返す（未入力）');
  });
});
