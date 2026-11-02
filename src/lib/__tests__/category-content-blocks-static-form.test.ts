import { describe, expect, it } from 'vitest';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { normalizeForm } from '@/lib/form-normalizer';
import type { Form } from '@/types/form';

function buildForm(contentBlocks: unknown[]): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat1', name: 'カット', display_name: 'カット', selection_mode: 'single',
            menus: [
              { id: 'm1', name: 'カット', price: 3000, duration: 30 },
              { id: 'm2', name: 'カラー', price: 5000, duration: 60 },
            ],
            options: [{ id: 'co1', name: '眉カット', price: 300, duration: 5 }, { id: 'co2', name: 'パック', price: 500, duration: 10 }],
            content_blocks: contentBlocks,
          },
        ],
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
      },
    },
  });
}

function render(form: Form) {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);
}

describe('カテゴリーごとのテキスト・画像ブロック（生成 HTML）', () => {
  const html = render(buildForm([
    { id: 'b_top', type: 'text', text: 'メニューの上', target: 'menus', position: 'top' },
    { id: 'b_m1', type: 'text', text: '[color=#dc2626]カットの下[/color]', target: 'menus', position: 'after', after_id: 'm1' },
    { id: 'b_bottom', type: 'image', image_url: 'https://example.com/menu.png', target: 'menus', position: 'bottom' },
    { id: 'b_o_top', type: 'text', text: 'オプションの上', target: 'options', position: 'top' },
    { id: 'b_o1', type: 'text', text: '眉の下', target: 'options', position: 'after', after_id: 'co1' },
    { id: 'b_o_bottom', type: 'text', text: 'オプションの下', target: 'options', position: 'bottom' },
  ]));
  const idx = (s: string) => {
    const i = html.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };

  it('メニュー欄: 一番上 → メニュー一覧 → 一番下 の順', () => {
    const top = idx('data-block-id="b_top"');
    const list = idx('<div class="menu-list">');
    const m1 = idx('data-menu-id="m1"');
    const afterM1 = idx('data-block-id="b_m1"');
    const m2 = idx('data-menu-id="m2"');
    const listEnd = html.indexOf('</div>', m2); // ざっくり: m2 の後
    const bottom = idx('data-block-id="b_bottom"');
    expect(top).toBeLessThan(list);
    expect(list).toBeLessThan(m1);
    expect(m1).toBeLessThan(afterM1);
    expect(afterM1).toBeLessThan(m2);
    expect(listEnd).toBeLessThan(bottom);
    expect(html.slice(afterM1, afterM1 + 200)).toContain('<span style="color:#dc2626">カットの下</span>');
    expect(html.slice(bottom, bottom + 200)).toContain('<img src="https://example.com/menu.png"');
  });

  it('オプション欄: 見出し → 一番上 → オプション一覧（眉の下） → 一番下 の順。メニュー欄の一番下より後ろ', () => {
    const menuBottom = idx('data-block-id="b_bottom"');
    const section = idx('class="category-options-section"');
    const oTop = idx('data-block-id="b_o_top"');
    const oList = idx('<div class="category-options-list">');
    const co1 = idx('data-option-id="co1"');
    const afterCo1 = idx('data-block-id="b_o1"');
    const co2 = idx('data-option-id="co2"');
    const oBottom = idx('data-block-id="b_o_bottom"');
    expect(menuBottom).toBeLessThan(section);
    expect(section).toBeLessThan(oTop);
    expect(oTop).toBeLessThan(oList);
    expect(oList).toBeLessThan(co1);
    expect(co1).toBeLessThan(afterCo1);
    expect(afterCo1).toBeLessThan(co2);
    expect(co2).toBeLessThan(oBottom);
  });

  it('CSS を埋め込む', () => {
    expect(html).toContain('.content-block.category-block');
  });
});

describe('カテゴリーごとのテキスト・画像ブロック: 描画しない条件', () => {
  it('ブロック未設定なら従来と同じ出力（category-block が出ない）', () => {
    const html = render(buildForm([]));
    expect(html).not.toContain('category-block"');
  });
  it('空テキスト・https 以外の画像は出さない。参照先が消えた「すぐ下」は一番下に出す', () => {
    const html = render(buildForm([
      { id: 'empty', type: 'text', text: '  ', target: 'menus', position: 'top' },
      { id: 'badimg', type: 'image', image_url: 'javascript:alert(1)', target: 'menus', position: 'top' },
      { id: 'gone', type: 'text', text: '消えたメニューの下', target: 'menus', position: 'after', after_id: 'deleted' },
    ]));
    expect(html).not.toContain('data-block-id="empty"');
    expect(html).not.toContain('data-block-id="badimg"');
    const m2 = html.indexOf('data-menu-id="m2"');
    const gone = html.indexOf('data-block-id="gone"');
    expect(gone).toBeGreaterThan(m2);
    expect(gone).toBeLessThan(html.indexOf('class="category-options-section"'));
  });
});
