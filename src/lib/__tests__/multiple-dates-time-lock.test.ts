import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { normalizeForm } from '@/lib/form-normalizer';
import { MD_TIME_PLACEHOLDER, MD_TIME_LOCKED_PLACEHOLDER } from '@/lib/multiple-dates-runtime-js';
import type { Form } from '@/types/form';
import type { SurveyConfig } from '@/types/survey';

async function loadDom(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return dom;
}

function pickFirstDate(dom: JSDOM, daySelect: HTMLSelectElement) {
  const first = Array.from(daySelect.options).find((o) => o.value !== '');
  if (!first) throw new Error('選べる日付がありません');
  daySelect.value = first.value;
  daySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function clearDate(dom: JSDOM, daySelect: HTMLSelectElement) {
  daySelect.value = '';
  daySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

/** 日付 → 時間 の順でしか選べないことを両フォーム共通で検証 */
async function assertTimeLockedUntilDate(dom: JSDOM, dayId: string, timeId: string) {
  const doc = dom.window.document;
  const daySelect = doc.getElementById(dayId) as HTMLSelectElement;
  const timeSelect = doc.getElementById(timeId) as HTMLSelectElement;

  // 初期: 日付未選択 → 時間は無効（グレーアウト）で「先に日付を選択」だけ
  expect(timeSelect.disabled).toBe(true);
  expect(timeSelect.options.length).toBe(1);
  expect(timeSelect.options[0].textContent).toBe(MD_TIME_LOCKED_PLACEHOLDER);

  // 日付を選ぶ → 有効になり「時間を選択」+ 時間の選択肢
  pickFirstDate(dom, daySelect);
  expect(timeSelect.disabled).toBe(false);
  expect(timeSelect.options[0].textContent).toBe(MD_TIME_PLACEHOLDER);
  expect(timeSelect.options.length).toBeGreaterThan(1);

  // 日付を未選択に戻す → また無効に戻る
  clearDate(dom, daySelect);
  expect(timeSelect.disabled).toBe(true);
  expect(timeSelect.options[0].textContent).toBe(MD_TIME_LOCKED_PLACEHOLDER);
}

describe('第三希望日時: 日付を選ぶまで「時間を選択」は無効', () => {
  it('予約フォーム（第三希望日時モード）', async () => {
    const form: Form = normalizeForm({
      id: 'form_test', store_id: 'st0001', form_type: 'line',
      config: {
        basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
        calendar_settings: {
          booking_mode: 'multiple_dates',
          multiple_dates_settings: { time_interval: 60, date_range_days: 30, exclude_weekdays: [], start_time: '09:00', end_time: '12:00' },
        },
      },
    });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('select.datetime-input:disabled');
    const dom = await loadDom(html);
    await assertTimeLockedUntilDate(dom, 'date1_day', 'date1_time');
  });

  it('アンケート（第三希望日時選択）', async () => {
    const config: SurveyConfig = {
      basic_info: { title: 'ご来店希望', liff_id: '', theme_color: '#3B82F6' },
      questions: [{
        id: 'q1', type: 'multiple_dates', title: 'ご希望の日時', required: true,
        multiple_dates: { time_interval: 60, date_range_days: 30, exclude_weekdays: [], start_time: '09:00', end_time: '12:00' },
      } as unknown as SurveyConfig['questions'][number]],
      ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
    };
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv_test', 'st0001');
    expect(html).toContain('select.datetime-input:disabled');
    const dom = await loadDom(html);
    await assertTimeLockedUntilDate(dom, 'q1_1_day', 'q1_1_time');
  });
});
