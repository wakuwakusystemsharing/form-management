import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

/** テスト用の最小フォーム（カスタムフィールド + 選択肢の追加質問） */
function buildForm(overrides: Partial<Form['config']['basic_info']> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6', ...overrides },
      custom_fields: [
        {
          id: 'cf1',
          type: 'radio',
          title: '駐車場の利用',
          required: false,
          options: [
            { label: 'はい', value: 'はい', additional_questions: [{ id: 'fq1', type: 'text', title: '車種', required: true }] },
            { label: 'いいえ', value: 'いいえ' },
          ],
        },
        {
          id: 'cf2',
          type: 'checkbox',
          title: '気になる点',
          required: false,
          options: [
            { label: '肌', value: '肌', additional_questions: [{ id: 'fq2', type: 'select', title: '肌の悩み', required: false, options: [{ label: '乾燥', value: '乾燥' }] }] },
            { label: '髪', value: '髪' },
          ],
        },
      ],
    },
  });
}

function render(form: Form, mode?: 'manual' | 'preview') {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, mode);
}

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  // DOMContentLoaded 後の初期化を待つ
  await new Promise((r) => setTimeout(r, 50));
  return { dom, errors };
}

describe('予約フォーム: カスタムフィールドの選択肢ごとの追加質問', () => {
  it('追加質問は初期状態で非表示で、親の項目の直後に描画される', () => {
    const html = render(buildForm());
    expect(html).toContain('id="aq-wrap-fq1"');
    expect(html).toContain('data-owner-field="cf1"');
    const parentIdx = html.indexOf('id="custom-field-wrap-cf1"');
    const fuIdx = html.indexOf('id="aq-wrap-fq1"');
    expect(parentIdx).toBeGreaterThan(0);
    expect(fuIdx).toBeGreaterThan(parentIdx);
    expect(html.slice(fuIdx, fuIdx + 120)).toContain('display:none');
  });

  it('単一選択: 該当の選択肢を選ぶと表示、別の選択肢で非表示 + 回答クリア', async () => {
    const { dom } = await loadDom(render(buildForm(), 'preview'));
    const doc = dom.window.document;
    const wrap = doc.getElementById('aq-wrap-fq1') as HTMLElement;
    expect(wrap.style.display).toBe('none');

    const yes = doc.querySelector('input[name="custom-field-cf1"][value="はい"]') as HTMLInputElement;
    yes.checked = true;
    yes.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(wrap.style.display).toBe('');

    const fuInput = doc.getElementById('custom-field-fq1') as HTMLInputElement;
    fuInput.value = 'プリウス';
    fuInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect((dom.window as unknown as { bookingForm: { state: { customFields: Record<string, unknown> } } }).bookingForm.state.customFields.fq1).toBe('プリウス');

    const no = doc.querySelector('input[name="custom-field-cf1"][value="いいえ"]') as HTMLInputElement;
    no.checked = true;
    yes.checked = false;
    no.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(wrap.style.display).toBe('none');
    expect((dom.window as unknown as { bookingForm: { state: { customFields: Record<string, unknown> } } }).bookingForm.state.customFields.fq1).toBeUndefined();
  });

  it('複数選択: チェックの ON/OFF に追従する', async () => {
    const { dom } = await loadDom(render(buildForm(), 'preview'));
    const doc = dom.window.document;
    const wrap = doc.getElementById('aq-wrap-fq2') as HTMLElement;
    const cb = doc.querySelector('input[data-field-id="cf2"][value="肌"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(wrap.style.display).toBe('');
    cb.checked = false;
    cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(wrap.style.display).toBe('none');
  });
});

describe('予約フォーム: 送信ボタンの文言と完了メッセージ', () => {
  it('未設定なら既定の文言', () => {
    const html = render(buildForm());
    expect(html).toContain('id="submit-button" class="submit-button">予約する<');
    expect(html).toContain("const SUBMIT_LABEL = \"予約する\"");
    expect(html).toContain('当日キャンセルは無いようにお願いいたします。');
  });

  it('基本情報で変更した文言が反映され、HTML エスケープされる', () => {
    const html = render(buildForm({ submit_button_label: ' 送信 <する> ', complete_message: 'ご予約ありがとうございます。' }));
    expect(html).toContain('id="submit-button" class="submit-button">送信 &lt;する&gt;<');
    expect(html).toContain("const SUBMIT_LABEL = \"送信 <する>\"");
    // 完了メッセージは FORM_CONFIG 経由でクライアントが参照する（既定文言はフォールバックとして残る）
    expect(html).toContain('"complete_message": "ご予約ありがとうございます。"');
  });

  it('店舗側手動予約フォームでは「予約を行う」のまま', () => {
    const html = render(buildForm({ submit_button_label: '送信' }), 'manual');
    expect(html).toContain('id="submit-button" class="submit-button">予約を行う<');
  });
});
