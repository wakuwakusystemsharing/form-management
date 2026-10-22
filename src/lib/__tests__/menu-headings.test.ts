import { describe, expect, it } from 'vitest';
import { DEFAULT_MENU_HEADING, DEFAULT_OPTIONS_HEADING, resolveMenuHeadings } from '@/lib/menu-headings';
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

describe('resolveMenuHeadings', () => {
  it('未設定 / 空 / 空白のみは既定文言', () => {
    expect(resolveMenuHeadings(undefined)).toEqual({ menu_heading: DEFAULT_MENU_HEADING, options_heading: DEFAULT_OPTIONS_HEADING });
    expect(resolveMenuHeadings(buildForm({ menu_heading: '', options_heading: '   ' }).config)).toEqual({ menu_heading: DEFAULT_MENU_HEADING, options_heading: DEFAULT_OPTIONS_HEADING });
  });

  it('設定値は前後の空白を除いて使う。40 文字で切る', () => {
    const r = resolveMenuHeadings(buildForm({ menu_heading: ' コースをお選びください ', options_heading: 'a'.repeat(50) }).config);
    expect(r.menu_heading).toBe('コースをお選びください');
    expect(r.options_heading).toBe('a'.repeat(40));
  });
});

describe('予約フォーム: メニュー / オプションの見出し文言', () => {
  it('未設定なら従来どおりの文言', () => {
    const html = render(buildForm());
    expect(html).toContain('<label class="field-label">メニューをお選びください</label>');
    expect(html).toContain('margin-bottom:0.75rem;">オプション</div>');
  });

  it('設定した文言がメニュー見出し・メニュー直下のオプション・カテゴリー共通オプションの 3 箇所に反映される', () => {
    const html = render(buildForm({ menu_heading: 'コースをお選びください', options_heading: '追加メニュー <任意>' }));
    expect(html).toContain('<label class="field-label">コースをお選びください</label>');
    expect(html).not.toContain('メニューをお選びください</label>');
    // メニュー直下（font-weight:500）とカテゴリー共通（font-weight:600）の両方。HTML エスケープされる
    expect(html).toContain('font-weight:500;color:#374151;margin-bottom:0.75rem;">追加メニュー &lt;任意&gt;</div>');
    expect(html).toContain('font-weight:600;color:#374151;margin-bottom:0.75rem;">追加メニュー &lt;任意&gt;</div>');
    expect(html).not.toContain('margin-bottom:0.75rem;">オプション</div>');
  });
});
