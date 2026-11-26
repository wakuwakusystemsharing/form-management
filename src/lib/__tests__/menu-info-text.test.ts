import { describe, expect, it } from 'vitest';
import { buildMenuInfoText, formatPriceDuration } from '@/lib/menu-info-text';
import type { MenuCategory } from '@/types/form';

const cat = (patch: Partial<MenuCategory>): MenuCategory => ({ id: 'c', name: 'カット', display_name: 'カット', menus: [], options: [], selection_mode: 'single', gender_condition: 'all', ...patch } as MenuCategory);

describe('料金と所要時間の書き方', () => {
  it('メニューは「4,400円 / 60分」、オプションは「+1,100円 / +10分」', () => {
    expect(formatPriceDuration({ price: 4400, duration: 60 })).toBe('4,400円 / 60分');
    expect(formatPriceDuration({ price: 1100, duration: 10 }, true)).toBe('+1,100円 / +10分');
  });

  it('所要時間が 0 のときは料金だけ。0 円のオプションに + は付けない', () => {
    expect(formatPriceDuration({ price: 500, duration: 0 }, true)).toBe('+500円');
    expect(formatPriceDuration({ price: 0, duration: 15 }, true)).toBe('0円 / +15分');
  });

  it('フォームで非表示にしている値には、その旨を付ける', () => {
    expect(formatPriceDuration({ price: 4400, duration: 60, hide_price: true })).toBe('4,400円 / 60分（※料金はフォームでは非表示）');
    expect(formatPriceDuration({ price: 4400, duration: 60, hide_price: true, hide_duration: true })).toBe('4,400円 / 60分（※料金・所要時間はフォームでは非表示）');
  });

  it('料金も所要時間も無いとき（サブメニューを使うメニュー）は空', () => {
    expect(formatPriceDuration({})).toBe('');
  });
});

describe('現在のメニュー情報の文章', () => {
  it('カテゴリー → メニュー → オプション の順に並べる', () => {
    const text = buildMenuInfoText({
      formName: '表参道店 予約フォーム',
      categories: [
        cat({
          menus: [
            { id: 'm1', name: 'カット', price: 4400, duration: 60, options: [{ id: 'o1', name: '炭酸スパ', price: 1100, duration: 10 }] },
            { id: 'm2', name: 'カラー', has_submenu: true, sub_menu_items: [{ id: 's1', name: 'リタッチ', price: 5500, duration: 60 }, { id: 's2', name: 'フルカラー', price: 7700, duration: 90 }] },
          ],
          options: [{ id: 'co1', name: 'トリートメント', price: 2200, duration: 15 }],
        } as Partial<MenuCategory>),
        cat({ id: 'c2', name: 'ヘッドスパ', display_name: '◆ヘッドスパ◆', menus: [{ id: 'm3', name: 'ヘッドスパ 30分', price: 3300, duration: 30 }] } as Partial<MenuCategory>),
      ],
    });
    expect(text).toBe(
      [
        '【表参道店 予約フォーム】',
        '現在のメニュー設定です。',
        '',
        '■ カット',
        '・カット　4,400円 / 60分',
        '　〔オプション〕',
        '　　＋ 炭酸スパ　+1,100円 / +10分',
        '・カラー',
        '　- リタッチ　5,500円 / 60分',
        '　- フルカラー　7,700円 / 90分',
        '〔このカテゴリー共通のオプション〕',
        '　＋ トリートメント　+2,200円 / +15分',
        '',
        '■ ◆ヘッドスパ◆',
        '・ヘッドスパ 30分　3,300円 / 30分',
        '',
        '※料金は設定されている金額です。「+」はオプションで足される料金・時間です。',
      ].join('\n')
    );
  });

  it('オプションのオプション（追加のオプション）は、親の下に見出しつきで並べる', () => {
    const text = buildMenuInfoText({
      categories: [
        cat({
          menus: [
            {
              id: 'm1',
              name: 'カット',
              price: 4400,
              duration: 60,
              options: [{ id: 'o1', name: 'シャンプー', price: 500, duration: 10, sub_options_label: '種類', sub_options_mode: 'single', sub_options_required: true, sub_options: [{ id: 'x1', name: 'オーガニック', price: 300, duration: 0 }] }],
            },
          ],
        } as Partial<MenuCategory>),
      ],
    });
    expect(text).toContain('　　＋ シャンプー　+500円 / +10分\n　　　〔種類：1 つだけ選べる・必須〕\n　　　└ オーガニック　+300円');
    expect(text.startsWith('現在のメニュー設定です。')).toBe(true);
  });

  it('サブメニューを使わないメニューに残っているサブメニューは出さない', () => {
    const text = buildMenuInfoText({ categories: [cat({ menus: [{ id: 'm1', name: 'カット', price: 4400, duration: 60, has_submenu: false, sub_menu_items: [{ id: 's1', name: '前の設定', price: 1, duration: 1 }] }] } as Partial<MenuCategory>)] });
    expect(text).not.toContain('前の設定');
    expect(text).toContain('・カット　4,400円 / 60分');
  });

  it('メニューもオプションも無いカテゴリーは出さない。全部空なら空文字', () => {
    expect(buildMenuInfoText({ formName: 'x', categories: [cat({})] })).toBe('');
    expect(buildMenuInfoText({ categories: null })).toBe('');
    const text = buildMenuInfoText({ categories: [cat({ name: '空', display_name: '空' }), cat({ id: 'c2', name: 'あり', display_name: 'あり', menus: [{ id: 'm', name: 'A', price: 100, duration: 10 }] } as Partial<MenuCategory>)] });
    expect(text).not.toContain('■ 空');
    expect(text).toContain('■ あり');
  });
});
