import { describe, expect, it } from 'vitest';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

/** カスタムフィールド 2 件 + その間に「画像orテキスト設置」ブロック */
function buildForm(config: Partial<Form['config']> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      custom_fields: [
        { id: 'cf1', type: 'text', title: '項目1', required: false },
        { id: 'cf2', type: 'text', title: '項目2', required: false },
      ],
      content_blocks: [
        { id: 'cb1', type: 'text', text: 'ブロック本文', anchor: 'custom_cf1', position: 'below' },
        { id: 'cb2', type: 'image', image_url: 'https://example.com/a.png', anchor: 'custom_cf2', position: 'above' },
      ],
      ...config,
    },
  });
}

function render(form: Form, mode?: 'manual' | 'preview') {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, mode);
}

function order(html: string, markers: string[]): number[] {
  return markers.map((m) => html.indexOf(m));
}

describe('予約フォーム: 画像orテキスト設置（カスタムフィールドを基準にした表示位置）', () => {
  it('標準位置のカスタムフィールドの間に描画される', () => {
    const html = render(buildForm());
    const [f1, b1, b2, f2] = order(html, [
      'id="custom-field-wrap-cf1"', 'content-block-text">ブロック本文', 'content-block-image"><img src="https://example.com/a.png"', 'id="custom-field-wrap-cf2"',
    ]);
    expect(f1).toBeGreaterThan(-1);
    expect(b1).toBeGreaterThan(f1);
    expect(b2).toBeGreaterThan(b1);
    expect(f2).toBeGreaterThan(b2);
  });

  it('表示位置を変更したカスタムフィールドに紐づくブロックも、そのフィールドの上下に描画される', () => {
    const html = render(buildForm({
      custom_fields: [
        { id: 'cf1', type: 'text', title: '項目1', required: false, placement: { anchor: 'message', position: 'below' } },
        { id: 'cf2', type: 'text', title: '項目2', required: false, placement: { anchor: 'submit', position: 'above' } },
      ],
    }));
    const [msg, f1, b1, b2, f2, submit] = order(html, [
      'id="message-field"', 'id="custom-field-wrap-cf1"', 'content-block-text">ブロック本文',
      'content-block-image"><img src="https://example.com/a.png"', 'id="custom-field-wrap-cf2"', 'id="submit-button"',
    ]);
    expect(msg).toBeGreaterThan(-1);
    expect(f1).toBeGreaterThan(msg);
    expect(b1).toBeGreaterThan(f1);
    expect(b2).toBeGreaterThan(b1);
    expect(f2).toBeGreaterThan(b2);
    expect(submit).toBeGreaterThan(f2);
  });

  it('手動予約フォーム / プレビューでも描画される', () => {
    for (const mode of ['manual', 'preview'] as const) {
      const html = render(buildForm(), mode);
      expect(html).toContain('content-block-text">ブロック本文');
      expect(html).toContain('content-block-image"><img src="https://example.com/a.png"');
    }
  });
});
