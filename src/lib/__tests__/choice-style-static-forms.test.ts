import { describe, expect, it } from 'vitest';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { normalizeForm } from '@/lib/form-normalizer';
import type { SurveyConfig } from '@/types/survey';
import type { Form } from '@/types/form';

describe('チェックボックス式の単一 / 複数選択（アンケート）', () => {
  const config: SurveyConfig = {
    basic_info: { title: 'T', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e' },
    questions: [
      { id: 'q1', type: 'radio', title: 'ボタン式', required: false, options: [{ label: 'A', value: 'A' }] },
      {
        id: 'q2', type: 'radio', title: '単一チェック', required: false, choice_style: 'checkbox', choice_size: 'large',
        options: [
          { label: 'B', value: 'B', follow_ups: [{ enabled: true, title: '追加', type: 'checkbox', choice_style: 'checkbox', options: [{ label: 'C', value: 'C' }] }] },
        ],
      },
      { id: 'q3', type: 'checkbox', title: '複数チェック', required: false, choice_style: 'checkbox', allow_other: true, options: [{ label: 'D', value: 'D' }] },
    ],
    ui_settings: { submit_button_text: '送信', theme_color: '#1b2a4e' },
  };
  const html = new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');

  it('ボタン式の質問は従来どおり（クラスなし）', () => {
    expect(html).toContain('<div class="button-group" id="container-q1">');
  });
  it('単一チェックは single + 大きさ、複数チェックは multi。「その他」もボタンとして同じ入れ物に入る', () => {
    expect(html).toContain('<div class="button-group choice-check choice-check--single choice-check--large" id="container-q2">');
    expect(html).toContain('<div class="button-group choice-check choice-check--multi choice-check--medium" id="container-q3">');
    const q3 = html.slice(html.indexOf('id="container-q3"'));
    expect(q3.slice(0, q3.indexOf('</div>'))).toContain('data-other="1"');
  });
  it('追加質問の入れ物にも付く', () => {
    expect(html).toContain('class="button-group choice-check choice-check--multi choice-check--medium" id="fu-container-q2-0-0"');
  });
  it('CSS を埋め込む（ボタン式の選択中 CSS より後ろ）', () => {
    const cssIdx = html.indexOf('.choice-check > .choice-button.selected');
    expect(cssIdx).toBeGreaterThan(0);
    expect(cssIdx).toBeGreaterThan(html.lastIndexOf('.choice-button.selected {'));
  });
  it('選択の JS は従来のまま（selectOption / choice-button）', () => {
    expect(html).toContain("onclick=\"selectOption(this, 'q2', 'radio')\"");
    expect(html).toContain("onclick=\"selectOption(this, 'q3', 'checkbox')\"");
  });
});

describe('チェックボックス式の単一 / 複数選択（予約フォームのカスタム項目・追加質問）', () => {
  const form: Form = normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      custom_fields: [
        { id: 'cf1', type: 'radio', title: 'ボタン式', required: false, options: [{ label: 'A', value: 'A' }] },
        {
          id: 'cf2', type: 'radio', title: '単一チェック', required: false, choice_style: 'checkbox', choice_size: 'small',
          options: [
            { label: 'B', value: 'B', additional_questions: [{ id: 'aq1', type: 'checkbox', title: '追加', required: false, choice_style: 'checkbox', options: [{ label: 'C', value: 'C' }] }] },
          ],
        },
        { id: 'cf3', type: 'checkbox', title: '複数チェック', required: false, choice_style: 'checkbox', options: [{ label: 'D', value: 'D' }] },
      ],
    },
  });
  const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

  it('ボタン式は従来どおり、チェック式は入れ物にクラスが付く（input の構造は同じ）', () => {
    expect(html).toContain('<div class="button-group custom-field-radios">');
    expect(html).toContain('<div class="button-group custom-field-radios choice-check choice-check--single choice-check--small">');
    expect(html).toContain('<div class="custom-field-checkboxes choice-check choice-check--multi choice-check--medium">');
    expect(html).toContain('<input type="radio" name="custom-field-cf2" value="B"');
  });
  it('選択肢の追加質問にも付く', () => {
    const aq = html.slice(html.indexOf('id="aq-wrap-aq1"'));
    expect(aq.slice(0, aq.indexOf('id="custom-field-wrap-cf3"'))).toContain('custom-field-checkboxes choice-check choice-check--multi');
  });
  it('CSS を埋め込む（.choice-label の選択中 CSS より後ろ）', () => {
    const cssIdx = html.indexOf('.choice-check > .choice-label.selected');
    expect(cssIdx).toBeGreaterThan(html.indexOf('.choice-label.selected {'));
  });
});
