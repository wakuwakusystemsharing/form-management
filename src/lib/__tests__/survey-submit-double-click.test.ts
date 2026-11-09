import { describe, expect, it } from 'vitest';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import type { SurveyForm } from '@/types/survey';

const form = {
  id: 'sv_test',
  store_id: 'st0001',
  status: 'active',
  config: {
    basic_info: { title: 'テスト', liff_id: '1234567890-abcdefgh', theme_color: '#13ca5e' },
    questions: [{ id: 'q1', title: 'お名前', type: 'text', required: true }],
    ui_settings: { submit_button_text: '送信', theme_color: '#13ca5e' },
  },
} as unknown as SurveyForm;

describe('アンケートフォーム 送信ボタンの連打対策（生成 HTML）', () => {
  const html = new StaticSurveyGenerator().generateHTML(form.config, form.id, form.store_id);

  it('送信中フラグで 2 回目以降のタップを無視し、ボタンを disabled にする', () => {
    expect(html).toContain('let svSubmitting = false;');
    expect(html).toContain('if (svSubmitting) return;');
    expect(html).toContain('submitBtn.disabled = true;');
    expect(html).toContain("submitBtn.textContent = '送信中…';");
    expect(html).toContain('async function submitFormInner()');
    expect(html).toContain('onclick="submitForm()" id="section-submit"');
  });

  it('入力エラーで止まったときだけ元に戻す（送信まで進んだら戻さない）', () => {
    expect(html).toContain('if (!reachedSend) {');
    expect(html).toContain('submitBtn.disabled = false;');
    // 送信まで進んだ経路は true を返す（LINE 送信成功 / 再ログイン / 送信失敗 / LINE 外）
    expect(html.match(/return true;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('disabled 時のスタイルを埋め込む', () => {
    expect(html).toContain('.submit-button:disabled');
  });
});
