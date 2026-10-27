import { describe, expect, it } from 'vitest';
import { resolveMenuHeadingContents, HEADING_CONTENT_TEXT_MAX } from '@/lib/menu-headings';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { normalizeForm } from '@/lib/form-normalizer';
import type { Form } from '@/types/form';

function buildForm(displayOptions: Record<string, unknown> = {}): Form {
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
              { id: 'm1', name: 'カット', price: 3000, duration: 30, options: [{ id: 'o1', name: 'シャンプー', price: 500, duration: 10 }] },
            ],
            options: [{ id: 'co1', name: '眉カット', price: 300, duration: 5 }],
          },
        ],
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false, ...displayOptions },
      },
    },
  });
}

function render(form: Form) {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);
}

/** メニュー欄の見出し `<label>` からカテゴリー一覧（最初の category-section）までの HTML */
function menuHeadingArea(html: string) {
  const start = html.indexOf('<label class="field-label">メニューをお選びください</label>');
  const end = html.indexOf('id="category-section-cat1"', start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

describe('resolveMenuHeadingContents', () => {
  it('未設定は空（画像なし・text_image）', () => {
    expect(resolveMenuHeadingContents(undefined)).toEqual({
      menu: { text: '', image: '', order: 'text_image' },
      options: { text: '', image: '', order: 'text_image' },
    });
  });

  it('前後の空白を除き、長さを切り、http(s) 以外の画像 URL は捨てる。並び順は image_text だけ受け付ける', () => {
    const r = resolveMenuHeadingContents(buildForm({
      menu_heading_text: ' 初回の方は[color=#dc2626]カウンセリング[/color]付き ',
      menu_heading_image: 'javascript:alert(1)',
      menu_heading_order: 'image_text',
      options_heading_text: 'x'.repeat(HEADING_CONTENT_TEXT_MAX + 10),
      options_heading_image: ' https://example.com/o.png ',
      options_heading_order: 'bogus',
    }).config);
    expect(r.menu).toEqual({ text: '初回の方は[color=#dc2626]カウンセリング[/color]付き', image: '', order: 'image_text' });
    expect(r.options.text).toBe('x'.repeat(HEADING_CONTENT_TEXT_MAX));
    expect(r.options.image).toBe('https://example.com/o.png');
    expect(r.options.order).toBe('text_image');
  });
});

describe('予約フォーム: 見出しの下のテキスト / 画像', () => {
  it('未設定なら何も出ない', () => {
    const html = render(buildForm());
    expect(html).not.toContain('<div class="heading-content');
  });

  it('メニュー見出しの直下にテキスト（色タグ反映・エスケープ）と画像が テキスト → 画像 の順で出る', () => {
    const html = render(buildForm({
      menu_heading_text: '初回は[color=#dc2626]カウンセリング[/color]付き <注意>\n2行目',
      menu_heading_image: 'https://example.com/m.png',
    }));
    const area = menuHeadingArea(html);
    expect(area).toContain('<div class="heading-content-text">初回は<span style="color:#dc2626">カウンセリング</span>付き &lt;注意&gt;<br>2行目</div>');
    expect(area).toContain('<div class="heading-content-image"><img src="https://example.com/m.png"');
    expect(area.indexOf('heading-content-text')).toBeLessThan(area.indexOf('heading-content-image'));
  });

  it('並び順 image_text なら画像が先', () => {
    const area = menuHeadingArea(render(buildForm({
      menu_heading_text: 'テキスト', menu_heading_image: 'https://example.com/m.png', menu_heading_order: 'image_text',
    })));
    expect(area.indexOf('heading-content-image')).toBeLessThan(area.indexOf('heading-content-text'));
  });

  it('http(s) 以外の画像 URL は出さない', () => {
    const html = render(buildForm({ menu_heading_image: 'javascript:alert(1)' }));
    expect(html).not.toContain('<div class="heading-content-image">');
  });

  it('オプション見出しの下にはメニュー直下・カテゴリー共通オプションの両方に出る（メニュー見出しの下には出ない）', () => {
    const html = render(buildForm({ options_heading_text: '複数選べます', options_heading_image: 'https://example.com/o.png' }));
    const textCount = html.split('<div class="heading-content-text">複数選べます</div>').length - 1;
    expect(textCount).toBe(2);
    expect(html.split('src="https://example.com/o.png"').length - 1).toBe(2);
    expect(menuHeadingArea(html)).not.toContain('<div class="heading-content');
    // メニュー直下のオプション欄: 見出し（font-weight:500）の直後
    const optStart = html.indexOf('id="options-m1"');
    const optHeading = html.indexOf('margin-bottom:0.75rem;">オプション</div>', optStart);
    const optContent = html.indexOf('heading-content-text', optStart);
    expect(optContent).toBeGreaterThan(optHeading);
    expect(optContent).toBeLessThan(html.indexOf('class="menu-option-item"', optStart));
    // カテゴリー共通オプション欄: 見出し（font-weight:600）の直後・ボタンの前
    const catStart = html.indexOf('class="category-options-section"');
    const catContent = html.indexOf('heading-content-text', catStart);
    expect(catContent).toBeGreaterThan(html.indexOf('オプション</div>', catStart));
    expect(catContent).toBeLessThan(html.indexOf('class="category-option-item"', catStart));
  });
});
