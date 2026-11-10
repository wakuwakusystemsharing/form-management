import { describe, expect, it } from 'vitest';
import {
  broadcastItemsToPreview,
  buildBroadcastPayloads,
  describeBroadcastItems,
  normalizeBroadcastItems,
  payloadsHavePersonalization,
  personalizePayloads,
  resolveRecipientName,
  validateBroadcastItems,
} from '@/lib/broadcast-items';
import type { BroadcastItem } from '@/types/broadcast';

const origin = 'https://app.example.com';
const id = '11111111-2222-3333-4444-555555555555';
const bubble = (uri?: string) => ({
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'hi' }] },
  ...(uri ? { footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'go', uri } }] } } : {}),
});

describe('normalizeBroadcastItems', () => {
  it('main は捨て、スタンプを受け付け、5 件まで', () => {
    const r = normalizeBroadcastItems([
      { type: 'main' },
      { type: 'text', text: 'a' },
      { type: 'sticker', sticker_id: 's1' },
      { type: 'ref', message_id: 'abcdefghij12' },
      { type: 'image', url: ' https://a/b.jpg ' },
      { type: 'video', url: 'https://a/v.mp4', preview_url: 'https://a/p.jpg' },
      { type: 'text', text: '6 件目' },
    ]);
    expect(r.map((x) => x.type)).toEqual(['text', 'sticker', 'ref', 'image', 'video']);
    expect(new Set(r.map((x) => x.key)).size).toBe(5);
    expect(normalizeBroadcastItems(null)).toEqual([]);
  });
});

describe('validateBroadcastItems', () => {
  it('下書きは 0 件でも可、送信時は 1 件以上', () => {
    expect(validateBroadcastItems([])).toBeNull();
    expect(validateBroadcastItems([], { requireContent: true })).toMatch(/1 つ以上/);
  });
  it('各種類の検証（LINE メッセージの並びと同じ規則 + スタンプ）', () => {
    const ok: BroadcastItem[] = [
      { key: 'a', type: 'text', text: 'こんにちは' },
      { key: 'b', type: 'sticker', sticker_id: 's1' },
      { key: 'c', type: 'ref', message_id: 'm1' },
    ];
    expect(validateBroadcastItems(ok, { messageIds: new Set(['m1']), stickerIds: new Set(['s1']) })).toBeNull();
    expect(validateBroadcastItems(ok, { messageIds: new Set(), stickerIds: new Set(['s1']) })).toMatch(/3 通目.*見つかりません/);
    expect(validateBroadcastItems(ok, { messageIds: new Set(['m1']), stickerIds: new Set() })).toMatch(/2 通目（スタンプ）/);
    expect(validateBroadcastItems([{ key: 'a', type: 'sticker', sticker_id: '' }])).toMatch(/選んでください/);
    expect(validateBroadcastItems([{ key: 'a', type: 'text', text: ' ' }])).toMatch(/1 通目（テキスト）/);
    expect(validateBroadcastItems([{ key: 'a', type: 'video', url: 'https://a/v.mp4', preview_url: '' }])).toMatch(/サムネイル/);
  });
});

describe('buildBroadcastPayloads', () => {
  const base = { origin, broadcastId: id, trackTaps: true, refMessages: {}, stickers: {} };

  it('並びの順に作る。スタンプは画像メッセージ、ref は参照先の送信用メッセージを展開', () => {
    const refMsgs = [{ type: 'flex', altText: 'r', contents: bubble() }, { type: 'text', text: '追伸' }];
    const r = buildBroadcastPayloads({
      ...base,
      items: [
        { key: 'a', type: 'text', text: '{name}さん、こんにちは' },
        { key: 'b', type: 'ref', message_id: 'm1' },
        { key: 'c', type: 'sticker', sticker_id: 's1' },
      ],
      refMessages: { m1: refMsgs },
      stickers: { s1: { url: 'https://cdn/s1.png', preview_url: 'https://cdn/s1_240.png' } },
    });
    expect(r.error).toBeNull();
    expect(r.payloads).toEqual([
      { type: 'text', text: '{name}さん、こんにちは' },
      ...refMsgs,
      { type: 'image', originalContentUrl: 'https://cdn/s1.png', previewImageUrl: 'https://cdn/s1_240.png' },
    ]);
    expect(r.has_personalization).toBe(true);
  });

  it('追加の Flex は計測リンク /go/b/{id}/{key} になる。計測 OFF ならそのまま', () => {
    const items: BroadcastItem[] = [
      { key: 'a', type: 'flex', alt_text: 'A', contents: bubble('https://example.com/a') },
      { key: 'b', type: 'flex', alt_text: '', contents: bubble('https://example.com/b') },
    ];
    const on = buildBroadcastPayloads({ ...base, items });
    expect(on.links).toEqual({ '1': 'https://example.com/a', '2': 'https://example.com/b' });
    const second = on.payloads[1] as { altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } } };
    expect(second.contents.footer.contents[0].action.uri).toBe(`${origin}/go/b/${id}/2`);
    expect(second.altText).toBe('メッセージが届いています');
    expect(on.has_personalization).toBe(false);
    const off = buildBroadcastPayloads({ ...base, trackTaps: false, items });
    expect(off.links).toEqual({});
    expect((off.payloads[0] as typeof second).contents.footer.contents[0].action.uri).toBe('https://example.com/a');
  });

  it('参照先・スタンプが無い / 展開して 5 通を超える / 大きすぎる Flex はエラー', () => {
    expect(buildBroadcastPayloads({ ...base, items: [{ key: 'a', type: 'ref', message_id: 'gone' }] }).error).toMatch(/見つかりません/);
    expect(buildBroadcastPayloads({ ...base, items: [{ key: 'a', type: 'sticker', sticker_id: 'gone' }] }).error).toMatch(/スタンプ/);
    const three = [{ type: 'text', text: '1' }, { type: 'text', text: '2' }, { type: 'text', text: '3' }];
    const over = buildBroadcastPayloads({ ...base, items: [{ key: 'a', type: 'ref', message_id: 'm' }, { key: 'b', type: 'ref', message_id: 'm' }], refMessages: { m: three } });
    expect(over.error).toMatch(/合計 6 通/);
    const big = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'あ'.repeat(12000) }] } };
    expect(buildBroadcastPayloads({ ...base, items: [{ key: 'a', type: 'flex', alt_text: 'a', contents: big }] }).error).toMatch(/30KB/);
  });
});

describe('差し込み（{name}）', () => {
  it('テキストメッセージだけが対象', () => {
    expect(payloadsHavePersonalization([{ type: 'text', text: 'こんにちは' }])).toBe(false);
    expect(payloadsHavePersonalization([{ type: 'flex', altText: '{name}', contents: {} }])).toBe(false);
    expect(payloadsHavePersonalization([{ type: 'text', text: '{name}様' }])).toBe(true);
  });
  it('名前は 顧客名 → LINE 表示名 → お客様。「未記入」は使わない', () => {
    expect(resolveRecipientName({ name: ' 山田 花子 ', line_display_name: 'はな' })).toBe('山田 花子');
    expect(resolveRecipientName({ name: '未記入', line_display_name: 'はな' })).toBe('はな');
    expect(resolveRecipientName({ name: '', line_display_name: null })).toBe('お客様');
  });
  it('置き換えた新しい配列を返す（元は変えない）', () => {
    const src = [{ type: 'text', text: '{name}さん、{name}さん' }, { type: 'image', originalContentUrl: 'https://a' }];
    const out = personalizePayloads(src, { name: '花子' });
    expect(out[0]).toEqual({ type: 'text', text: '花子さん、花子さん' });
    expect(out[1]).toBe(src[1]);
    expect(src[0].text).toBe('{name}さん、{name}さん');
  });
});

describe('プレビュー・説明', () => {
  it('broadcastItemsToPreview', () => {
    const r = broadcastItemsToPreview(
      [
        { key: 'a', type: 'text', text: '{name}さん' },
        { key: 'b', type: 'sticker', sticker_id: 's1' },
        { key: 'c', type: 'ref', message_id: 'm1' },
        { key: 'd', type: 'sticker', sticker_id: 'gone' },
      ],
      { ref: (mid) => (mid === 'm1' ? [{ type: 'text', text: 'ref' }] : null), sticker: (sid) => (sid === 's1' ? 'https://cdn/s1.png' : null), sampleName: '花子' }
    );
    expect(r).toEqual([{ type: 'text', text: '花子さん' }, { type: 'image', url: 'https://cdn/s1.png' }, { type: 'text', text: 'ref' }]);
  });
  it('describeBroadcastItems', () => {
    expect(describeBroadcastItems([])).toBe('メッセージなし');
    expect(describeBroadcastItems([{ key: 'a', type: 'ref', message_id: 'm' }, { key: 'b', type: 'sticker', sticker_id: 's' }])).toBe('保存済み + スタンプ');
  });
});
