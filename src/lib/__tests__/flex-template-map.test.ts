import { describe, expect, it } from 'vitest';
import { applyTemplateOp, buildTemplateFieldMap, findItemRootPath, isTemplateBound, itemRootOf, setData } from '@/lib/flex-template-map';
import { buildTemplateFlex, defaultTemplateData, LINE_FLEX_TEMPLATES } from '@/lib/line-flex-templates';
import { getAt, walkFlex } from '@/lib/flex-tree';
import type { BookingCardData, FlexContainer, LineFlexTemplate, MenuCarouselData, MenuListData, StepsCardData, StoreCardData } from '@/types/line-flex';

const img = 'https://cdn.example.com/a.jpg';
const booking: BookingCardData = {
  image_url: img,
  title: 'ご予約はこちら',
  text: '24 時間いつでも予約できます',
  buttons: [
    { key: 'a', label: '予約する', url: 'https://liff.line.me/1-a' },
    { key: 'b', label: '電話する', url: 'tel:0312345678' },
    { key: 'c', label: '地図', url: 'https://maps.example.com' },
  ],
  color: '#06C755',
};
const menu: MenuCarouselData = {
  items: [
    { key: 'a', name: 'カット', price: '¥4,400', duration: '60分', description: 'シャンプー込み', image_url: img, button: null },
    { key: 'x', name: '', price: '¥0', button: null }, // 名前が空 = 表示されない
    { key: 'b', name: 'カラー', price: '¥7,700', button: null },
    { key: 'c', name: 'パーマ', price: '¥8,800', button: null },
  ],
  button_label: '予約する',
  button_url: 'https://liff.line.me/1-a',
  color: '#f49031',
};
const list: MenuListData = {
  title: '料金表',
  items: [
    { key: 'a', name: 'カット', price: '¥4,400', note: '60分' },
    { key: 'b', name: 'カラー', price: '¥7,700' },
    { key: 'c', name: 'パーマ', price: '¥8,800' },
  ],
  footnote: '※ 税込',
  button: { key: 'b1', label: '予約する', url: 'https://liff.line.me/1-a' },
};

const build = (template: LineFlexTemplate, data: unknown) => buildTemplateFlex(template, data as never) as FlexContainer;
const pathOfText = (root: FlexContainer, text: string) => {
  let hit: string | null = null;
  walkFlex(root, (n, p) => {
    if (hit === null && n.type === 'text' && n.text === text) hit = p;
  });
  return hit as unknown as string;
};

describe('setData', () => {
  it('入れ子の位置を書き換えた新しいオブジェクトを返す', () => {
    const next = setData(menu, ['items', 2, 'name'], 'ハイライト');
    expect(next.items[2].name).toBe('ハイライト');
    expect(menu.items[2].name).toBe('カラー');
    expect(next.items[0]).toBe(menu.items[0]);
  });
});

describe('buildTemplateFieldMap（パーツ → 入力項目の対応）', () => {
  it('予約導線カード: 見出し・説明・画像・ボタンの文言と URL', () => {
    const c = build('booking_card', booking);
    const map = buildTemplateFieldMap('booking_card', booking)!;
    expect(map.text[pathOfText(c, 'ご予約はこちら')]).toEqual(['title']);
    expect(map.text[pathOfText(c, '24 時間いつでも予約できます')]).toEqual(['text']);
    expect(map.image.hero).toEqual(['image_url']);
    expect(map.buttonLabel['footer/contents/1']).toEqual(['buttons', 1, 'label']);
    expect(map.buttonUrl['footer/contents/1']).toEqual(['buttons', 1, 'url']);
    // ボタンは「一覧の 1 件ぶん」
    expect(map.itemRoots['footer/contents/0']).toEqual({ list: 'buttons', index: 0 });
    expect(map.itemRoots['footer/contents/2']).toEqual({ list: 'buttons', index: 2 });
    expect(map.itemRoots.footer).toBeUndefined();
  });

  it('メニューカルーセル: カード = 一覧の 1 件。名前が空の件は飛ばして対応する。共通ボタンは共通の項目', () => {
    const c = build('menu_carousel', menu);
    const map = buildTemplateFieldMap('menu_carousel', menu)!;
    expect(map.itemRoots['contents/0']).toEqual({ list: 'items', index: 0 });
    expect(map.itemRoots['contents/1']).toEqual({ list: 'items', index: 2 });
    expect(map.itemRoots['contents/2']).toEqual({ list: 'items', index: 3 });
    expect(map.text[pathOfText(c, 'カラー')]).toEqual(['items', 2, 'name']);
    expect(map.text[pathOfText(c, '¥8,800')]).toEqual(['items', 3, 'price']);
    expect(map.image['contents/0/hero']).toEqual(['items', 0, 'image_url']);
    expect(map.buttonLabel['contents/1/footer/contents/0']).toEqual(['button_label']);
    expect(map.buttonUrl['contents/1/footer/contents/0']).toEqual(['button_url']);
    // カードの中のパーツからも、そのカード（1 件）を引ける
    expect(itemRootOf(map, pathOfText(c, 'カラー'))).toEqual({ path: 'contents/1', list: 'items', index: 2 });
    expect(findItemRootPath(map, { list: 'items', index: 3 })).toBe('contents/2');
  });

  it('料金表: 行 = 一覧の 1 件（区切り線は対象外）', () => {
    const c = build('menu_list', list);
    const map = buildTemplateFieldMap('menu_list', list)!;
    const rows = Object.entries(map.itemRoots).sort((a, b) => a[1].index - b[1].index);
    expect(rows.map(([, r]) => r.index)).toEqual([0, 1, 2]);
    expect(getAt(c, rows[1][0])?.type).toBe('box');
    expect(map.text[pathOfText(c, '60分')]).toEqual(['items', 0, 'note']);
    expect(map.text[pathOfText(c, '※ 税込')]).toEqual(['footnote']);
    expect(isTemplateBound(map, rows[0][0], getAt(c, rows[0][0]))).toBe(true);
  });

  it('店舗紹介カード: 電話番号は値の一致で対応。アイコン付きの見出し（🕒 営業時間）は対応しない', () => {
    const store: StoreCardData = { name: 'テスト店', hours: '10:00〜19:00', phone: '03-1234-5678', address: '東京都', booking_url: 'https://liff.line.me/1-a' };
    const c = build('store_card', store);
    const map = buildTemplateFieldMap('store_card', store)!;
    expect(map.text[pathOfText(c, '03-1234-5678')]).toEqual(['phone']);
    expect(map.text[pathOfText(c, '10:00〜19:00')]).toEqual(['hours']);
    expect(map.text[pathOfText(c, '🕒 営業時間')]).toBeUndefined();
    // 「電話する」ボタンは電話番号から作られるので、文言は入力項目に無い
    const telButton = Object.keys(map.buttonUrl).length;
    expect(telButton).toBe(1); // 予約ボタンの URL だけ
  });

  it('全テンプレート: 既定値（を埋めたもの）で対応表が作れ、対応したパスは実際のパーツを指す', () => {
    for (const t of LINE_FLEX_TEMPLATES) {
      if (t.id === 'custom') {
        expect(buildTemplateFieldMap('custom', {})).toBeNull();
        continue;
      }
      const d = { ...(defaultTemplateData(t.id, '#06C755') as Record<string, unknown>) };
      for (const k of ['title', 'name', 'text', 'body', 'highlight']) if (k in d && !d[k]) d[k] = `サンプル${k}`;
      if (Array.isArray(d.items) && d.items.length === 0) d.items = [{ key: 'a', name: '項目A', price: '¥1' }, { key: 'b', name: '項目B', price: '¥2' }];
      if (Array.isArray(d.steps) && d.steps.length === 0) d.steps = [{ key: 'a', title: '手順A' }, { key: 'b', title: '手順B' }];
      const c = buildTemplateFlex(t.id, d as never);
      expect(c, t.id).not.toBeNull();
      const map = buildTemplateFieldMap(t.id, d as never);
      expect(map, t.id).not.toBeNull();
      expect(Object.keys(map!.text).length, t.id).toBeGreaterThan(0);
      for (const p of [...Object.keys(map!.text), ...Object.keys(map!.image), ...Object.keys(map!.buttonLabel), ...Object.keys(map!.itemRoots)]) {
        expect(getAt(c, p), `${t.id} ${p}`).toBeDefined();
      }
    }
  });

  it('作れない入力（必須項目が空）は null', () => {
    expect(buildTemplateFieldMap('booking_card', { title: '', text: '', buttons: [] })).toBeNull();
  });
});

describe('applyTemplateOp（操作を入力値に書き戻す）', () => {
  it('文字・画像・ボタンの文言と URL', () => {
    const c = build('booking_card', booking);
    const map = buildTemplateFieldMap('booking_card', booking);
    const t1 = applyTemplateOp(booking, map, c, { type: 'text', path: pathOfText(c, 'ご予約はこちら'), text: '新しい見出し' })!;
    expect((t1.data as BookingCardData).title).toBe('新しい見出し');
    expect(booking.title).toBe('ご予約はこちら');
    const i1 = applyTemplateOp(booking, map, c, { type: 'image', path: 'hero', url: 'https://cdn.example.com/new.jpg' })!;
    expect((i1.data as BookingCardData).image_url).toBe('https://cdn.example.com/new.jpg');
    const b1 = applyTemplateOp(booking, map, c, { type: 'buttonLabel', path: 'footer/contents/0', label: '今すぐ予約' })!;
    expect((b1.data as BookingCardData).buttons[0].label).toBe('今すぐ予約');
    const b2 = applyTemplateOp(booking, map, c, { type: 'buttonUrl', path: 'footer/contents/2', url: 'https://example.com/map' })!;
    expect((b2.data as BookingCardData).buttons[2].url).toBe('https://example.com/map');
    // 書き戻した入力値から、同じ内容の Flex が組み立つ
    expect(pathOfText(build('booking_card', t1.data), '新しい見出し')).toBe(pathOfText(c, 'ご予約はこちら'));
  });

  it('入力項目に無いパーツ・見た目の変更は null（自由編集にする）', () => {
    const c = build('booking_card', booking);
    const map = buildTemplateFieldMap('booking_card', booking);
    expect(applyTemplateOp(booking, map, c, { type: 'text', path: 'body', text: 'x' })).toBeNull();
    expect(applyTemplateOp(booking, map, c, { type: 'move', path: pathOfText(c, 'ご予約はこちら'), dir: 1 })).toBeNull();
    expect(applyTemplateOp(booking, map, c, { type: 'remove', path: 'hero' })).toBeNull();
    expect(applyTemplateOp(booking, null, c, { type: 'text', path: 'hero', text: 'x' })).toBeNull();
  });

  it('ボタンの並び替え・複製・削除', () => {
    const c = build('booking_card', booking);
    const map = buildTemplateFieldMap('booking_card', booking);
    const moved = applyTemplateOp(booking, map, c, { type: 'move', path: 'footer/contents/0', dir: 1 })!;
    expect((moved.data as BookingCardData).buttons.map((b) => b.label)).toEqual(['電話する', '予約する', '地図']);
    expect(moved.selectItem).toEqual({ list: 'buttons', index: 1 });
    expect(applyTemplateOp(booking, map, c, { type: 'move', path: 'footer/contents/0', dir: -1 })).toBeNull();
    const removed = applyTemplateOp(booking, map, c, { type: 'remove', path: 'footer/contents/1' })!;
    expect((removed.data as BookingCardData).buttons.map((b) => b.label)).toEqual(['予約する', '地図']);
    const dup = applyTemplateOp(booking, map, c, { type: 'duplicate', path: 'footer/contents/0' }, () => 'newkey')!;
    expect((dup.data as BookingCardData).buttons.map((b) => [b.key, b.label])).toEqual([['a', '予約する'], ['newkey', '予約する'], ['b', '電話する'], ['c', '地図']]);
  });

  it('カルーセルのカード: 名前が空の件（表示されない）は動かさずに並び替える', () => {
    const c = build('menu_carousel', menu);
    const map = buildTemplateFieldMap('menu_carousel', menu);
    // 表示は [カット, カラー, パーマ]（入力値では 0, 2, 3 番目）。カラーを先頭へ
    const moved = applyTemplateOp(menu, map, c, { type: 'move', path: 'contents/1', dir: -1 })!;
    expect((moved.data as MenuCarouselData).items.map((i) => i.name)).toEqual(['カラー', '', 'カット', 'パーマ']);
    expect(moved.selectItem).toEqual({ list: 'items', index: 0 });
    const next = build('menu_carousel', moved.data);
    expect(findItemRootPath(buildTemplateFieldMap('menu_carousel', moved.data), moved.selectItem!)).toBe('contents/0');
    expect(pathOfText(next, 'カラー')).toBe('contents/0/body/contents/0');
    // ドラッグ: カットを 3 枚目の位置へ
    const dragged = applyTemplateOp(menu, map, c, { type: 'moveTo', path: 'contents/0', index: 2 })!;
    expect((dragged.data as MenuCarouselData).items.map((i) => i.name)).toEqual(['カラー', '', 'パーマ', 'カット']);
    const removed = applyTemplateOp(menu, map, c, { type: 'remove', path: 'contents/2' })!;
    expect((removed.data as MenuCarouselData).items.map((i) => i.name)).toEqual(['カット', '', 'カラー']);
  });

  it('料金表の行・ステップ: 区切り線をまたいで並び替える', () => {
    const c = build('menu_list', list);
    const map = buildTemplateFieldMap('menu_list', list);
    const rowPath = (i: number) => findItemRootPath(map, { list: 'items', index: i })!;
    const down = applyTemplateOp(list, map, c, { type: 'move', path: rowPath(0), dir: 1 })!;
    expect((down.data as MenuListData).items.map((i) => i.name)).toEqual(['カラー', 'カット', 'パーマ']);
    // ドラッグ: 1 行目を、最後の行の位置（区切り線を含めた並びの 4 番目）へ
    const last = Number(rowPath(2).split('/').pop());
    const dragged = applyTemplateOp(list, map, c, { type: 'moveTo', path: rowPath(0), index: last })!;
    expect((dragged.data as MenuListData).items.map((i) => i.name)).toEqual(['カラー', 'パーマ', 'カット']);

    const steps: StepsCardData = { title: '流れ', steps: [{ key: 'a', title: '予約' }, { key: 'b', title: '来店' }, { key: 'c', title: '会計' }] };
    const sc = build('steps_card', steps);
    const smap = buildTemplateFieldMap('steps_card', steps);
    const up = applyTemplateOp(steps, smap, sc, { type: 'move', path: findItemRootPath(smap, { list: 'steps', index: 2 })!, dir: -1 })!;
    expect((up.data as StepsCardData).steps.map((s) => s.title)).toEqual(['予約', '会計', '来店']);
  });
});
