import { describe, expect, it } from 'vitest';
import {
  buildBookingCardFlex,
  buildLinePayload,
  buildMenuCarouselFlex,
  buildStoreCardFlex,
  describeFlexContents,
  instrumentFlexLinks,
  matchesKeyword,
  menuCarouselFromForm,
  normalizeKeywords,
  payloadBytes,
  resolveFlexContents,
  storeCardFromStore,
  validateFlexContents,
} from '@/lib/line-flex-templates';

const asObj = (v: unknown) => v as Record<string, any>;

describe('予約導線カード', () => {
  it('画像 + 見出し + 本文 + ボタン（先頭が primary、最大 3、不正な URL のボタンは除く）', () => {
    const flex = asObj(buildBookingCardFlex({
      image_url: 'https://example.com/a.jpg',
      title: 'ご予約はこちら',
      text: '24時間受付',
      color: '#ff6600',
      buttons: [
        { key: '1', label: '予約する', url: 'https://liff.line.me/123-abc' },
        { key: '2', label: '電話', url: 'tel:0312345678' },
        { key: '3', label: '不正', url: 'http://insecure.example.com' },
        { key: '4', label: '地図', url: 'https://maps.example.com' },
      ],
    }));
    expect(flex.type).toBe('bubble');
    expect(flex.hero.url).toBe('https://example.com/a.jpg');
    expect(flex.body.contents[0].text).toBe('ご予約はこちら');
    expect(flex.body.contents[1].text).toBe('24時間受付');
    const buttons = flex.footer.contents;
    expect(buttons).toHaveLength(2); // 3 つ目は http で除外、4 つ目は上限で切られる
    expect(buttons[0].style).toBe('primary');
    expect(buttons[0].color).toBe('#ff6600');
    expect(buttons[0].action).toEqual({ type: 'uri', label: '予約する', uri: 'https://liff.line.me/123-abc' });
    expect(buttons[1].style).toBe('secondary');
  });
  it('見出しも本文も空なら null。画像が https でなければ hero を付けない', () => {
    expect(buildBookingCardFlex({ title: ' ', text: '', buttons: [] })).toBeNull();
    const flex = asObj(buildBookingCardFlex({ image_url: 'http://x', title: 't', text: '', buttons: [] }));
    expect(flex.hero).toBeUndefined();
    expect(flex.footer).toBeUndefined();
  });
});

describe('メニュー・料金カルーセル', () => {
  it('名前の無いカードは除き、2 枚以上で carousel、1 枚なら bubble。共通ボタンを全カードに付ける', () => {
    const flex = asObj(buildMenuCarouselFlex({
      items: [
        { key: 'a', name: 'カット', price: '¥3,000', duration: '30分', description: '説明' },
        { key: 'b', name: '', price: '¥1' },
        { key: 'c', name: 'カラー', button: { key: 'x', label: '詳しく', url: 'https://example.com/color' } },
      ],
      button_label: '予約する',
      button_url: 'https://liff.line.me/1-a',
    }));
    expect(flex.type).toBe('carousel');
    expect(flex.contents).toHaveLength(2);
    expect(flex.contents[0].body.contents[1].contents.map((c: any) => c.text)).toEqual(['¥3,000', '30分']);
    expect(flex.contents[0].footer.contents[0].action.uri).toBe('https://liff.line.me/1-a');
    expect(flex.contents[1].footer.contents[0].action.label).toBe('詳しく');
    const single = asObj(buildMenuCarouselFlex({ items: [{ key: 'a', name: 'カット' }] }));
    expect(single.type).toBe('bubble');
    expect(buildMenuCarouselFlex({ items: [] })).toBeNull();
  });
  it('13 枚以上は 12 枚に切る', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ key: `k${i}`, name: `メニュー${i}` }));
    expect(asObj(buildMenuCarouselFlex({ items })).contents).toHaveLength(12);
  });
  it('予約フォームのメニュー構成から下書きを作る（価格・所要時間の表示文字列、LIFF URL）', () => {
    const data = menuCarouselFromForm({
      config: {
        basic_info: { liff_id: '2000-xyz' },
        menu_structure: { categories: [{ menus: [{ id: 'm1', name: 'カット', price: 3300, duration: 60, description: 'd', image: 'https://img/1.jpg' }, { id: 'm2', name: 'カラー', price: 0 }] }] },
      },
    });
    expect(data.items).toEqual([
      { key: 'm1', name: 'カット', price: '¥3,300', duration: '60分', description: 'd', image_url: 'https://img/1.jpg', button: null },
      { key: 'm2', name: 'カラー', price: '', duration: '', description: '', image_url: '', button: null },
    ]);
    expect(data.button_url).toBe('https://liff.line.me/2000-xyz');
    expect(data.button_label).toBe('予約する');
  });
});

describe('店舗紹介カード', () => {
  it('営業時間・電話・住所の行と、予約 / 電話 / 地図 / サイト のボタン', () => {
    const flex = asObj(buildStoreCardFlex({
      name: 'テスト店', hours: '10:00-19:00', phone: '03-1234-5678', address: '東京都…',
      map_url: 'https://maps.example.com', website_url: 'https://example.com', booking_url: 'https://liff.line.me/1-a',
    }));
    const rows = flex.body.contents[1].contents;
    expect(rows).toHaveLength(3);
    expect(rows[1].contents[1].text).toBe('03-1234-5678');
    const actions = flex.footer.contents.map((b: any) => [b.action.label, b.action.uri, b.style]);
    expect(actions).toEqual([
      ['予約する', 'https://liff.line.me/1-a', 'primary'],
      ['電話する', 'tel:0312345678', 'secondary'],
      ['地図を開く', 'https://maps.example.com', 'secondary'],
      ['公式サイト', 'https://example.com', 'secondary'],
    ]);
  });
  it('店舗情報から下書き（住所から地図 URL、ロゴを画像に）。名前が空なら null', () => {
    const data = storeCardFromStore({ name: 'A店', phone: '03', address: '東京都渋谷区1-1', website_url: 'https://a.example', logo_url: 'https://a.example/logo.png' }, 'https://liff.line.me/9');
    expect(data.map_url).toBe('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('東京都渋谷区1-1'));
    expect(data.image_url).toBe('https://a.example/logo.png');
    expect(data.booking_url).toBe('https://liff.line.me/9');
    expect(buildStoreCardFlex({ name: '' })).toBeNull();
  });
});

describe('計測リンク', () => {
  it('https の uri アクションだけを /go/{id}/{key} に置き換え、tel: と計測済みはそのまま。元は壊さない', () => {
    const contents = asObj(buildBookingCardFlex({
      title: 't', text: '', buttons: [
        { key: '1', label: 'a', url: 'https://a.example' },
        { key: '2', label: 'b', url: 'tel:03' },
        { key: '3', label: 'c', url: 'https://b.example' },
      ],
    }));
    const { contents: out, links } = instrumentFlexLinks(contents, 'https://app.example.com/', 'abcdefghijkl');
    const uris = asObj(out).footer.contents.map((b: any) => b.action.uri);
    expect(uris).toEqual(['https://app.example.com/go/abcdefghijkl/1', 'tel:03', 'https://app.example.com/go/abcdefghijkl/2']);
    expect(links).toEqual({ '1': 'https://a.example', '2': 'https://b.example' });
    expect(contents.footer.contents[0].action.uri).toBe('https://a.example');
    const again = instrumentFlexLinks(out, 'https://app.example.com', 'abcdefghijkl');
    expect(again.links).toEqual({});
  });
});

describe('検証・正規化', () => {
  it('validateFlexContents', () => {
    expect(validateFlexContents(null)).toContain('空');
    expect(validateFlexContents({ type: 'text' })).toContain('bubble か carousel');
    expect(validateFlexContents({ type: 'carousel', contents: [] })).toContain('1 枚も');
    expect(validateFlexContents({ type: 'carousel', contents: Array(13).fill({ type: 'bubble' }) })).toContain('12 枚');
    expect(validateFlexContents({ type: 'carousel', contents: [{ type: 'box' }] })).toContain('bubble だけ');
    expect(validateFlexContents({ type: 'bubble', body: {} })).toBeNull();
  });
  it('normalizeKeywords / matchesKeyword（完全一致・大文字小文字無視・前後空白無視）', () => {
    expect(normalizeKeywords(' メニュー , クーポン\nメニュー,,Menu,menu')).toEqual(['メニュー', 'クーポン', 'Menu']);
    expect(normalizeKeywords(Array.from({ length: 15 }, (_, i) => `k${i}`))).toHaveLength(10);
    expect(matchesKeyword(['メニュー'], ' メニュー ')).toBe(true);
    expect(matchesKeyword(['Menu'], 'menu')).toBe(true);
    expect(matchesKeyword(['メニュー'], 'メニューを見たい')).toBe(false);
    expect(matchesKeyword(['メニュー'], '')).toBe(false);
  });
  it('buildLinePayload は altText を 400 文字に切り、空なら既定文言。payloadBytes は UTF-8 のバイト数', () => {
    const p = buildLinePayload('x'.repeat(500), { type: 'bubble' });
    expect((p.altText as string).length).toBe(400);
    expect(buildLinePayload('  ', { type: 'bubble' }).altText).toBe('メッセージが届いています');
    expect(payloadBytes({ a: 'あ' })).toBe(Buffer.byteLength(JSON.stringify({ a: 'あ' }), 'utf8'));
  });
  it('resolveFlexContents は JSON 編集を優先。describeFlexContents', () => {
    expect(resolveFlexContents({ template: 'booking_card', data: { title: 't', text: '', buttons: [] }, flex_override: { type: 'bubble', id: 'x' } })).toEqual({ type: 'bubble', id: 'x' });
    expect(resolveFlexContents({ template: 'custom', data: {} as never, flex_override: null })).toBeNull();
    expect(describeFlexContents({ type: 'carousel', contents: [1, 2] })).toBe('カード 2 枚');
    expect(describeFlexContents({ type: 'bubble' })).toBe('カード 1 枚');
    expect(describeFlexContents(null)).toBe('内容なし');
  });
});
