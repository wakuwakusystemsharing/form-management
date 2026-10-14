import { describe, expect, it } from 'vitest';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { buildReservationDetailItems } from '../reservation-detail-items';
import type { Form } from '@/types/form';

/** お名前 / 電話番号 / メッセージ欄の設定（見出し・必須 / 任意・メッセージ欄の非表示） */
function buildForm(calendar: Partial<Form['config']['calendar_settings']> = {}, extra: Partial<Form['config']> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      calendar_settings: { ...calendar },
      ...extra,
    },
  });
}

function render(form: Form, mode?: 'manual' | 'preview') {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, mode);
}

describe('normalizeForm: お名前 / 電話番号 / メッセージ欄の既定値', () => {
  it('未設定なら 見出しは空・必須 true・メッセージ欄 表示', () => {
    const cs = buildForm().config.calendar_settings;
    expect(cs.customer_name_label).toBe('');
    expect(cs.require_customer_name).toBe(true);
    expect(cs.require_customer_phone).toBe(true);
    expect(cs.show_message_field).toBe(true);
    expect(cs.message_label).toBe('');
  });

  it('設定値を保持する', () => {
    const cs = buildForm({
      customer_name_label: '氏名', require_customer_name: false, require_customer_phone: false,
      show_message_field: false, message_label: 'ご要望',
    }).config.calendar_settings;
    expect(cs.customer_name_label).toBe('氏名');
    expect(cs.require_customer_name).toBe(false);
    expect(cs.require_customer_phone).toBe(false);
    expect(cs.show_message_field).toBe(false);
    expect(cs.message_label).toBe('ご要望');
  });
});

describe('予約フォーム: お名前の見出し', () => {
  it('既定は「お名前」で必須マーク付き', () => {
    const html = render(buildForm());
    expect(html).toContain('<label class="field-label">お名前 <span class="required">*</span></label>');
    expect(html).toContain('<label class="field-label">電話番号 <span class="required">*</span></label>');
  });

  it('見出しを変更すると入力欄・ご予約内容・未入力アラートに反映される（LINE メッセージの《お名前》は固定）', () => {
    const html = render(buildForm({ customer_name_label: '氏名（フルネーム）' }));
    expect(html).toContain('<label class="field-label">氏名（フルネーム） <span class="required">*</span></label>');
    expect(html).toContain('《お名前》');
    expect(html).not.toContain('<label class="field-label">お名前 ');
    // ご予約内容・アラートは設定値から組み立てる
    expect(html).toContain("customer_name_label");
  });

  it('HTML として安全にエスケープされる', () => {
    const html = render(buildForm({ customer_name_label: '<b>名前</b>' }));
    expect(html).toContain('&lt;b&gt;名前&lt;/b&gt; <span class="required">*</span>');
  });
});

describe('予約フォーム: お名前 / 電話番号の必須・任意', () => {
  it('任意にすると「（任意）」表示になり、必須チェックをスキップするフラグが埋め込まれる', () => {
    const html = render(buildForm({ require_customer_name: false, require_customer_phone: false }));
    expect(html).toContain('お名前 <span class="optional-mark">（任意）</span>');
    expect(html).toContain('電話番号 <span class="optional-mark">（任意）</span>');
    expect(html).toContain('"customer_name_optional": true');
    expect(html).toContain('"customer_phone_optional": true');
  });

  it('片方だけ任意にできる', () => {
    const html = render(buildForm({ require_customer_phone: false }));
    expect(html).toContain('お名前 <span class="required">*</span>');
    expect(html).toContain('電話番号 <span class="optional-mark">（任意）</span>');
    expect(html).toContain('"customer_name_optional": false');
    expect(html).toContain('"customer_phone_optional": true');
  });

  it('手動予約フォームは通常フォームの必須設定ではなく manual_form_settings に従う', () => {
    const html = render(buildForm(
      { require_customer_name: false, require_customer_phone: false },
      { manual_form_settings: { require_customer_name: true, require_customer_phone: true } },
    ), 'manual');
    expect(html).toContain('お名前 <span class="required">*</span>');
    expect(html).toContain('電話番号 <span class="required">*</span>');
  });
});

describe('予約フォーム: メッセージ欄', () => {
  it('既定は「メッセージ（任意）」で表示される', () => {
    const html = render(buildForm());
    expect(html).toContain('id="message-field"');
    expect(html).toContain('<label class="field-label">メッセージ（任意）</label>');
  });

  it('見出しを変更できる（「（任意）」は自動で付く）', () => {
    const html = render(buildForm({ message_label: 'ご要望' }));
    expect(html).toContain('<label class="field-label">ご要望（任意）</label>');
  });

  it('非表示にすると入力欄を描画しない', () => {
    const html = render(buildForm({ show_message_field: false }));
    expect(html).not.toContain('id="message-field"');
    expect(html).not.toContain('id="customer-message"');
  });

  it('非表示のフォームではメール・管理画面の予約内容に「メッセージ」を載せない', () => {
    const shown = buildReservationDetailItems(buildForm().config, { customer_name: '山田', customer_phone: '090', reservation_date: '2026-10-20', reservation_time: '10:00' });
    expect(shown.some((i) => i.label === 'メッセージ')).toBe(true);
    const hidden = buildReservationDetailItems(buildForm({ show_message_field: false }).config, { customer_name: '山田', customer_phone: '090', reservation_date: '2026-10-20', reservation_time: '10:00' });
    expect(hidden.some((i) => i.label === 'メッセージ')).toBe(false);
  });
});
