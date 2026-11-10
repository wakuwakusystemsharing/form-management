import { describe, expect, it } from 'vitest';
import { prepareLineFlexMessage } from '@/lib/line-flex-service';

const origin = 'https://app.example.com';

describe('prepareLineFlexMessage（保存時の検証と送信用 payload の生成）', () => {
  it('テンプレートから payload（計測リンク入り）と links を作る。キーワードは正規化', () => {
    const r = prepareLineFlexMessage(
      'st0001',
      {
        id: 'abcdefghij12',
        name: ' 予約カード ',
        template: 'booking_card',
        alt_text: 'ご予約はこちら',
        keywords: ['メニュー', ' メニュー', 'Menu'],
        data: { title: 'タイトル', text: '本文', buttons: [{ key: '1', label: '予約', url: 'https://liff.line.me/1-a' }, { key: '2', label: '電話', url: 'tel:03' }] },
      },
      origin,
      null
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe('abcdefghij12');
    expect(r.value.name).toBe('予約カード');
    expect(r.value.keywords).toEqual(['メニュー', 'Menu']);
    expect(r.value.links).toEqual({ '1': 'https://liff.line.me/1-a' });
    const payload = r.value.payload as { type: string; altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } } };
    expect(payload.type).toBe('flex');
    expect(payload.altText).toBe('ご予約はこちら');
    expect(payload.contents.footer.contents[0].action.uri).toBe('https://app.example.com/go/abcdefghij12/1');
    expect(payload.contents.footer.contents[1].action.uri).toBe('tel:03');
    expect(r.value.track_taps).toBe(true);
    expect(r.value.enabled).toBe(true);
  });

  it('計測 OFF なら URL をそのまま。既存行があれば id・統計・作成日時を引き継ぐ', () => {
    const existing = {
      id: 'zzzzzzzzzzzz', store_id: 'st0001', name: 'old', template: 'booking_card', data: {}, flex_override: null, alt_text: 'a', keywords: [],
      attach_confirm: false, attach_reminder: false, attach_follow: false, enabled: true, track_taps: true, items: [{ key: 'main', type: 'main' as const }], payload: null, payloads: null, links: {},
      reply_count: 7, tap_counts: { '1': 3 }, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    } as const;
    const r = prepareLineFlexMessage(
      'st0001',
      { id: 'abcdefghij12', name: 'n', template: 'booking_card', alt_text: 'a', track_taps: false, data: { title: 't', text: '', buttons: [{ key: '1', label: 'b', url: 'https://x.example' }] } },
      origin,
      existing as never
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe('zzzzzzzzzzzz');
    expect(r.value.links).toEqual({});
    expect(r.value.reply_count).toBe(7);
    expect(r.value.tap_counts).toEqual({ '1': 3 });
    expect(r.value.created_at).toBe('2026-01-01T00:00:00.000Z');
    const payload = r.value.payload as { contents: { footer: { contents: Array<{ action: { uri: string } }> } } };
    expect(payload.contents.footer.contents[0].action.uri).toBe('https://x.example');
  });

  it('入力エラー: 名前なし / 代替テキストなし / 内容が空 / custom なのに JSON なし / 不正な ID は振り直し', () => {
    const base = { name: 'n', template: 'booking_card' as const, alt_text: 'a', data: { title: 't', text: '', buttons: [] } };
    expect(prepareLineFlexMessage('s', { ...base, name: ' ' }, origin, null)).toMatchObject({ ok: false, status: 400 });
    expect(prepareLineFlexMessage('s', { ...base, alt_text: '' }, origin, null)).toMatchObject({ ok: false, status: 400 });
    expect(prepareLineFlexMessage('s', { ...base, data: { title: '', text: '', buttons: [] } }, origin, null)).toMatchObject({ ok: false, status: 400 });
    expect(prepareLineFlexMessage('s', { name: 'n', template: 'custom', alt_text: 'a', data: {} }, origin, null)).toMatchObject({ ok: false, status: 400 });
    const r = prepareLineFlexMessage('s', { ...base, id: 'BAD ID' }, origin, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toMatch(/^[a-z0-9]{12}$/);
  });

  it('custom は flex_override をそのまま使い、30KB を超えると弾く', () => {
    const ok = prepareLineFlexMessage('s', { name: 'n', template: 'custom', alt_text: 'a', data: {}, flex_override: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'hi' }] } } }, origin, null);
    expect(ok.ok).toBe(true);
    const big = prepareLineFlexMessage('s', { name: 'n', template: 'custom', alt_text: 'a', data: {}, flex_override: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'x'.repeat(31 * 1024) }] } } }, origin, null);
    expect(big).toMatchObject({ ok: false, status: 400 });
    if (!big.ok) expect(big.error).toContain('30KB');
  });
});

describe('prepareLineFlexMessage（追加のメッセージ = items → payloads）', () => {
  const base = {
    id: 'abcdefghij12',
    name: 'n',
    template: 'booking_card' as const,
    alt_text: 'alt',
    data: { title: 't', text: 'b', buttons: [{ key: '1', label: '予約', url: 'https://liff.line.me/1-a' }] },
  };
  const otherRow = {
    id: 'otherotherot', store_id: 'st0001', name: '他', template: 'custom' as const, data: {}, flex_override: null, alt_text: 'o', keywords: [],
    attach_confirm: false, attach_reminder: false, attach_follow: false, enabled: true, track_taps: true, items: [{ key: 'main', type: 'main' as const }],
    payload: { type: 'flex', altText: 'o', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'o' }] } } },
    payloads: null, links: {}, reply_count: 0, tap_counts: {}, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };

  it('items が無ければ main だけ。payloads は payload 1 通', () => {
    const r = prepareLineFlexMessage('st0001', base, origin, null, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([{ key: 'main', type: 'main' }]);
    expect(r.value.payloads).toEqual([r.value.payload]);
  });

  it('テキスト → Flex 本体 → 保存済みメッセージ の順で payloads を作る。追加 Flex の計測キーは続き番号', () => {
    const r = prepareLineFlexMessage(
      'st0001',
      {
        ...base,
        items: [
          { key: 't', type: 'text', text: 'こんにちは' },
          { key: 'm', type: 'main' },
          { key: 'r', type: 'ref', message_id: 'otherotherot' },
          { key: 'f', type: 'flex', alt_text: '', contents: { type: 'bubble', footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'x', uri: 'https://example.com/x' } }] } } },
        ],
      },
      origin,
      null,
      [otherRow]
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payloads?.map((p) => p.type)).toEqual(['text', 'flex', 'flex', 'flex']);
    expect(r.value.payloads?.[2]).toEqual(otherRow.payload);
    expect(r.value.links).toEqual({ '1': 'https://liff.line.me/1-a', '2': 'https://example.com/x' });
  });

  it('参照先が無い・自分自身・空のテキストは 400', () => {
    expect(prepareLineFlexMessage('st0001', { ...base, items: [{ key: 'm', type: 'main' }, { key: 'r', type: 'ref', message_id: 'nothere00000' }] }, origin, null, [otherRow])).toMatchObject({ ok: false, status: 400 });
    expect(prepareLineFlexMessage('st0001', { ...base, items: [{ key: 'm', type: 'main' }, { key: 'r', type: 'ref', message_id: 'abcdefghij12' }] }, origin, null, [otherRow])).toMatchObject({ ok: false, status: 400 });
    expect(prepareLineFlexMessage('st0001', { ...base, items: [{ key: 'm', type: 'main' }, { key: 't', type: 'text', text: ' ' }] }, origin, null, [])).toMatchObject({ ok: false, status: 400 });
  });
});
