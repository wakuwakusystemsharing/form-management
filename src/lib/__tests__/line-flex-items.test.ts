import { describe, expect, it } from 'vitest';
import {
  buildLineFlexPayloads,
  describeLineFlexItems,
  itemsToPreview,
  lineFlexItemsReference,
  LINE_FLEX_ITEMS_MAX,
  normalizeLineFlexItems,
  payloadsToPreview,
  validateLineFlexItems,
  type LineFlexItem,
} from '@/lib/line-flex-items';
import { instrumentFlexLinks } from '@/lib/line-flex-templates';

const bubble = (uri?: string) => ({
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'hi' }] },
  ...(uri ? { footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'go', uri } }] } } : {}),
});

describe('normalizeLineFlexItems', () => {
  it('空・不正 → main だけ', () => {
    expect(normalizeLineFlexItems(undefined)).toEqual([{ key: 'main', type: 'main' }]);
    expect(normalizeLineFlexItems('x')).toEqual([{ key: 'main', type: 'main' }]);
    expect(normalizeLineFlexItems([{ type: 'bogus' }])).toEqual([{ key: 'main', type: 'main' }]);
  });
  it('main が無ければ先頭に足し、2 つ目の main は捨てる。5 通を超える分は捨てる', () => {
    const r = normalizeLineFlexItems([{ key: 't', type: 'text', text: 'a' }, { key: 'm', type: 'main' }, { type: 'main' }]);
    expect(r.map((x) => x.type)).toEqual(['text', 'main']);
    const many = normalizeLineFlexItems([
      ...Array.from({ length: 6 }, (_, i) => ({ key: `t${i}`, type: 'text', text: String(i) })),
      { key: 'm', type: 'main' },
    ]);
    expect(many).toHaveLength(LINE_FLEX_ITEMS_MAX);
    expect(many.some((x) => x.type === 'main')).toBe(true);
  });
  it('各種類の項目を整える（キーが無ければ振る）', () => {
    const r = normalizeLineFlexItems([
      { type: 'main' },
      { type: 'image', url: ' https://a/b.jpg ' },
      { type: 'video', url: 'https://a/v.mp4', preview_url: 'https://a/p.jpg' },
      { type: 'flex', alt_text: 'alt', contents: bubble() },
      { type: 'ref', message_id: 'abcdefghij12' },
    ]);
    expect(r).toHaveLength(5);
    expect(r[1]).toMatchObject({ type: 'image', url: 'https://a/b.jpg' });
    expect((r[1] as { preview_url?: string }).preview_url).toBeUndefined();
    expect(r[3]).toMatchObject({ type: 'flex', alt_text: 'alt' });
    expect(r[4]).toMatchObject({ type: 'ref', message_id: 'abcdefghij12' });
    expect(new Set(r.map((x) => x.key)).size).toBe(5);
  });
});

describe('validateLineFlexItems', () => {
  const main: LineFlexItem = { key: 'm', type: 'main' };
  it('OK なら null', () => {
    expect(validateLineFlexItems([main, { key: 't', type: 'text', text: 'こんにちは' }])).toBeNull();
    expect(validateLineFlexItems([main, { key: 'i', type: 'image', url: 'https://a/b.jpg' }])).toBeNull();
    expect(validateLineFlexItems([main, { key: 'v', type: 'video', url: 'https://a/v.mp4', preview_url: 'https://a/p.jpg' }])).toBeNull();
    expect(validateLineFlexItems([main, { key: 'f', type: 'flex', alt_text: 'a', contents: bubble() }])).toBeNull();
    expect(validateLineFlexItems([main, { key: 'r', type: 'ref', message_id: 'other' }], { selfId: 'me', existingIds: new Set(['other']) })).toBeNull();
  });
  it('空のテキスト・http の画像・サムネイル無しの動画・壊れた Flex・自分自身の参照・無い参照先はエラー', () => {
    expect(validateLineFlexItems([main, { key: 't', type: 'text', text: '  ' }])).toMatch(/テキスト/);
    expect(validateLineFlexItems([main, { key: 'i', type: 'image', url: 'http://a/b.jpg' }])).toMatch(/https/);
    expect(validateLineFlexItems([main, { key: 'v', type: 'video', url: 'https://a/v.mp4', preview_url: '' }])).toMatch(/サムネイル/);
    expect(validateLineFlexItems([main, { key: 'f', type: 'flex', alt_text: 'a', contents: null }])).toMatch(/Flex/);
    expect(validateLineFlexItems([main, { key: 'r', type: 'ref', message_id: 'me' }], { selfId: 'me' })).toMatch(/自分自身/);
    expect(validateLineFlexItems([main, { key: 'r', type: 'ref', message_id: 'gone' }], { existingIds: new Set() })).toMatch(/見つかりません/);
  });
  it('main が無い / 6 通以上はエラー', () => {
    expect(validateLineFlexItems([{ key: 't', type: 'text', text: 'a' }])).toMatch(/Flex 本体/);
    expect(validateLineFlexItems([main, ...Array.from({ length: 5 }, (_, i) => ({ key: `t${i}`, type: 'text' as const, text: 'a' }))])).toMatch(/5 通/);
  });
});

describe('buildLineFlexPayloads', () => {
  const origin = 'https://app.example.com';
  const id = 'abcdefghij12';
  const mainRaw = bubble('https://liff.line.me/1-a');
  const mainInst = instrumentFlexLinks(mainRaw, origin, id);
  const mainPayload = { type: 'flex', altText: 'main', contents: mainInst.contents };

  it('items の順に送信用メッセージを作る。画像のサムネイルは無ければ同じ URL', () => {
    const r = buildLineFlexPayloads({
      items: [
        { key: 't', type: 'text', text: 'こんにちは' },
        { key: 'm', type: 'main' },
        { key: 'i', type: 'image', url: 'https://a/b.jpg' },
        { key: 'v', type: 'video', url: 'https://a/v.mp4', preview_url: 'https://a/p.jpg' },
      ],
      mainPayload,
      mainLinks: mainInst.links,
      origin,
      messageId: id,
      trackTaps: true,
      refPayloads: {},
    });
    expect(r.error).toBeNull();
    expect(r.payloads.map((p) => p.type)).toEqual(['text', 'flex', 'image', 'video']);
    expect(r.payloads[0]).toEqual({ type: 'text', text: 'こんにちは' });
    expect(r.payloads[2]).toEqual({ type: 'image', originalContentUrl: 'https://a/b.jpg', previewImageUrl: 'https://a/b.jpg' });
    expect(r.payloads[3]).toEqual({ type: 'video', originalContentUrl: 'https://a/v.mp4', previewImageUrl: 'https://a/p.jpg' });
    expect(r.links).toEqual({ '1': 'https://liff.line.me/1-a' });
  });

  it('追加の Flex（JSON）の計測キーは main の続き番号。計測 OFF なら URL はそのまま', () => {
    const items: LineFlexItem[] = [{ key: 'm', type: 'main' }, { key: 'f', type: 'flex', alt_text: '', contents: bubble('https://example.com/x') }];
    const on = buildLineFlexPayloads({ items, mainPayload, mainLinks: mainInst.links, origin, messageId: id, trackTaps: true, refPayloads: {} });
    expect(on.links).toEqual({ '1': 'https://liff.line.me/1-a', '2': 'https://example.com/x' });
    const second = on.payloads[1] as { altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } } };
    expect(second.contents.footer.contents[0].action.uri).toBe(`${origin}/go/${id}/2`);
    expect(second.altText).toBe('メッセージが届いています');
    const off = buildLineFlexPayloads({ items, mainPayload: { type: 'flex', altText: 'main', contents: mainRaw }, mainLinks: {}, origin, messageId: id, trackTaps: false, refPayloads: {} });
    expect(off.links).toEqual({});
    expect((off.payloads[1] as typeof second).contents.footer.contents[0].action.uri).toBe('https://example.com/x');
  });

  it('ref は参照先の payload をそのまま。無ければ飛ばす', () => {
    const refPayload = { type: 'flex', altText: 'other', contents: bubble() };
    const r = buildLineFlexPayloads({
      items: [{ key: 'm', type: 'main' }, { key: 'r', type: 'ref', message_id: 'other' }, { key: 'r2', type: 'ref', message_id: 'gone' }],
      mainPayload,
      mainLinks: {},
      origin,
      messageId: id,
      trackTaps: true,
      refPayloads: { other: refPayload },
    });
    expect(r.payloads).toEqual([mainPayload, refPayload]);
  });

  it('大きすぎる追加 Flex はエラー', () => {
    const big = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'あ'.repeat(12000) }] } };
    const r = buildLineFlexPayloads({ items: [{ key: 'm', type: 'main' }, { key: 'f', type: 'flex', alt_text: 'a', contents: big }], mainPayload, mainLinks: {}, origin, messageId: id, trackTaps: false, refPayloads: {} });
    expect(r.error).toMatch(/30KB/);
  });
});

describe('プレビュー変換・補助', () => {
  it('payloadsToPreview は送信用メッセージをプレビュー用に変換', () => {
    const r = payloadsToPreview([
      { type: 'text', text: 'a' },
      { type: 'flex', altText: 'x', contents: bubble() },
      { type: 'image', originalContentUrl: 'https://a/o.jpg', previewImageUrl: 'https://a/p.jpg' },
      { type: 'video', originalContentUrl: 'https://a/v.mp4', previewImageUrl: 'https://a/t.jpg' },
      null,
    ]);
    expect(r).toEqual([
      { type: 'text', text: 'a' },
      { type: 'flex', contents: bubble(), altText: 'x' },
      { type: 'image', url: 'https://a/p.jpg' },
      { type: 'video', previewUrl: 'https://a/t.jpg', url: 'https://a/v.mp4' },
    ]);
  });
  it('itemsToPreview は編集中の内容と参照先を引く。空のテキスト・壊れた Flex は出さない', () => {
    const r = itemsToPreview(
      [{ key: 'm', type: 'main' }, { key: 't', type: 'text', text: ' ' }, { key: 'f', type: 'flex', alt_text: '', contents: null }, { key: 'r', type: 'ref', message_id: 'o' }],
      bubble(),
      'alt',
      (mid) => (mid === 'o' ? { contents: bubble('https://x'), altText: 'ref' } : null)
    );
    expect(r.map((x) => x.type)).toEqual(['flex', 'flex']);
    expect(r[1]).toMatchObject({ altText: 'ref' });
    // Flex 本体にだけ main の印が付く（プレビューで直接編集できる 1 通）
    expect(r[0]).toMatchObject({ main: true });
    expect((r[1] as { main?: boolean }).main).toBeUndefined();
  });
  it('lineFlexItemsReference / describeLineFlexItems', () => {
    const items: LineFlexItem[] = [{ key: 'm', type: 'main' }, { key: 'r', type: 'ref', message_id: 'o' }, { key: 't', type: 'text', text: 'a' }];
    expect(lineFlexItemsReference(items, 'o')).toBe(true);
    expect(lineFlexItemsReference(items, 'z')).toBe(false);
    expect(describeLineFlexItems(items)).toBe('Flex + 保存済み + テキスト = 3 通');
    expect(describeLineFlexItems([{ key: 'm', type: 'main' }])).toBe('');
  });
});
