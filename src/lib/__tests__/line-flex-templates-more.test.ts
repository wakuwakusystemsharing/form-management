import { describe, expect, it } from 'vitest';
import {
  buildCouponCardFlex,
  buildMenuListFlex,
  buildNoticeCardFlex,
  buildStaffCarouselFlex,
  buildStepsCardFlex,
  buildTemplateFlex,
  defaultTemplateData,
  LINE_FLEX_TEMPLATES,
  menuListFromForm,
  validateFlexContents,
} from '@/lib/line-flex-templates';

const asObj = (v: unknown) => v as Record<string, any>;

describe('テンプレート一覧', () => {
  it('JSON から作成が一番上。全 9 種が既定値から生成でき、検証を通る', () => {
    expect(LINE_FLEX_TEMPLATES[0].id).toBe('custom');
    expect(LINE_FLEX_TEMPLATES).toHaveLength(9);
    for (const t of LINE_FLEX_TEMPLATES) {
      if (t.id === 'custom') continue;
      const data = defaultTemplateData(t.id, '#ff6600');
      // 既定値が空の雛形（店舗紹介・お知らせ・カルーセル）は最低限の値を入れる
      const filled = { ...data, name: 'A店', title: (data as any).title || 'タイトル', body: (data as any).body || '本文', items: (data as any).items?.length ? (data as any).items : [{ key: 'k', name: 'カット', price: '¥3,000' }] };
      const flex = buildTemplateFlex(t.id, filled as never);
      expect(flex, t.id).not.toBeNull();
      expect(validateFlexContents(flex), t.id).toBeNull();
    }
  });
});

describe('クーポン・キャンペーン', () => {
  it('見出し + 大きな割引 + 期限・条件 + コード枠 + ボタン', () => {
    const flex = asObj(buildCouponCardFlex({ title: '友だち限定', highlight: '10% OFF', description: '提示で', expires: '2026/12/31', conditions: '併用不可', code: 'LINE10', button: { key: 'b', label: '予約', url: 'https://liff.line.me/1' }, color: '#ff6600' }));
    const body = flex.body.contents;
    expect(body[0].text).toBe('友だち限定');
    expect(body[1]).toMatchObject({ text: '10% OFF', size: '3xl', weight: 'bold' });
    const rows = body.find((c: any) => c.type === 'box' && c.contents?.[0]?.layout === 'baseline').contents;
    expect(rows).toHaveLength(2);
    const codeBox = body[body.length - 1];
    expect(codeBox.borderColor).toBe('#ff6600');
    expect(codeBox.contents[1].text).toBe('LINE10');
    expect(flex.footer.contents[0].action.uri).toBe('https://liff.line.me/1');
    expect(buildCouponCardFlex({ title: '', highlight: '' })).toBeNull();
  });
});

describe('お知らせ・営業案内', () => {
  it('色付きヘッダー（分類 + 見出し）+ 日付 + 本文。ボタン無しなら footer 無し', () => {
    const flex = asObj(buildNoticeCardFlex({ label: 'お知らせ', title: '年末年始の営業', date: '2026年12月28日', body: '12/31〜1/3 はお休みです', color: '#1e90ff' }));
    expect(flex.header.backgroundColor).toBe('#1e90ff');
    expect(flex.header.contents.map((c: any) => c.text)).toEqual(['お知らせ', '年末年始の営業']);
    expect(flex.body.contents[0].text).toBe('2026年12月28日');
    expect(flex.body.contents[1].text).toBe('12/31〜1/3 はお休みです');
    expect(flex.footer).toBeUndefined();
    expect(buildNoticeCardFlex({ title: '', body: '' })).toBeNull();
  });
});

describe('料金表（リスト）', () => {
  it('名前・補足・料金の行を区切り線で並べ、15 行で切る。フォームから下書き', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, name: `メニュー${i}`, price: `¥${i}`, note: i === 0 ? '60分' : '' }));
    const flex = asObj(buildMenuListFlex({ title: '料金', items, footnote: '税込' }));
    const list = flex.body.contents[1].contents;
    expect(list.filter((c: any) => c.type === 'separator')).toHaveLength(14);
    expect(list.filter((c: any) => c.type === 'box')).toHaveLength(15);
    const first = list[0];
    expect(first.contents[0].contents.map((c: any) => c.text)).toEqual(['メニュー0', '60分']);
    expect(first.contents[1]).toMatchObject({ text: '¥0', align: 'end' });
    expect(flex.body.contents[2].text).toBe('税込');

    const draft = menuListFromForm({ config: { basic_info: { liff_id: '1-a' }, menu_structure: { categories: [{ menus: [{ id: 'm1', name: 'カット', price: 3300, duration: 60 }] }] } } });
    expect(draft.items).toEqual([{ key: 'm1', name: 'カット', price: '¥3,300', note: '60分' }]);
    expect(draft.button?.url).toBe('https://liff.line.me/1-a');
  });
});

describe('スタッフ紹介カルーセル', () => {
  it('写真（1:1）・名前・役職・ひとこと・共通ボタン。名前の無い人は除く', () => {
    const flex = asObj(buildStaffCarouselFlex({
      items: [
        { key: 'a', image_url: 'https://img/a.jpg', name: '田中', role: 'カラー担当', comment: 'よろしく' },
        { key: 'b', name: '' },
        { key: 'c', name: '佐藤', button: { key: 'x', label: '指名', url: 'https://liff.line.me/2' } },
      ],
      button_label: 'このスタッフで予約',
      button_url: 'https://liff.line.me/1',
    }));
    expect(flex.type).toBe('carousel');
    expect(flex.contents).toHaveLength(2);
    expect(flex.contents[0].hero.aspectRatio).toBe('1:1');
    expect(flex.contents[0].body.contents.map((c: any) => c.text)).toEqual(['田中', 'カラー担当', 'よろしく']);
    expect(flex.contents[0].footer.contents[0].action.uri).toBe('https://liff.line.me/1');
    expect(flex.contents[1].footer.contents[0].action.label).toBe('指名');
  });
});

describe('ご利用の流れ', () => {
  it('番号付きの丸 + ステップ名 + 説明。8 件で切る', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, title: `手順${i + 1}`, text: i === 0 ? '説明' : '' }));
    const flex = asObj(buildStepsCardFlex({ title: '流れ', steps, color: '#ff6600', button: { key: 'b', label: '予約', url: 'https://liff.line.me/1' } }));
    const boxes = flex.body.contents[1].contents;
    expect(boxes).toHaveLength(8);
    expect(boxes[0].contents[0]).toMatchObject({ width: '28px', cornerRadius: '14px', backgroundColor: '#ff6600' });
    expect(boxes[0].contents[0].contents[0].text).toBe('1');
    expect(boxes[0].contents[1].contents.map((c: any) => c.text)).toEqual(['手順1', '説明']);
    expect(boxes[7].contents[0].contents[0].text).toBe('8');
    expect(flex.footer.contents[0].action.label).toBe('予約');
  });
});
