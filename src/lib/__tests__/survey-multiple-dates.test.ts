import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { createDefaultMultipleDatesSettings, getRequiredChoices, getVisibleChoices, normalizeMultipleDatesSettings } from '@/lib/multiple-dates-settings';
import type { SurveyConfig } from '@/types/survey';

type SurveyWindow = Window & {
  mdGetWeekdayHours: (settings: unknown, dayOfWeek: number, date: Date) => { open: string; close: string; closed: boolean; special?: boolean };
  mdIsDateSelectable: (settings: unknown, date: Date, blocked?: (d: Date) => boolean) => boolean;
  mdPopulateTimeOptions: (select: HTMLSelectElement, settings: unknown, dateStr: string, opts?: unknown) => void;
  mdFormatDateTimeJa: (d: string, t: string) => string;
  collectMultipleDatesAnswer: (q: unknown) => { error: string | null; value: string };
  getEffectiveHolidayType: (d: Date) => string | null;
};

/** 生成 HTML に埋め込まれるのと同じ形（正規化済み）の質問 */
const normalizedQuestion = (overrides: Record<string, unknown> = {}) => {
  const q = mdQuestion(overrides);
  return { ...q, multiple_dates: normalizeMultipleDatesSettings(q.multiple_dates) };
};

function makeConfig(question: Record<string, unknown>): SurveyConfig {
  return {
    basic_info: { title: 'ご来店希望アンケート', liff_id: '', theme_color: '#3B82F6' },
    questions: [question as unknown as SurveyConfig['questions'][number]],
    ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
  };
}

const mdQuestion = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1',
  type: 'multiple_dates',
  title: 'ご希望の日時',
  required: true,
  multiple_dates: {
    time_interval: 60,
    date_range_days: 30,
    weekday_hours: {
      '0': { open: '09:00', close: '18:00', closed: true },  // 日曜定休
      '1': { open: '09:00', close: '12:00', closed: false, extra_slots: [{ label: '午前中', after: 'start' }] },
    },
    holiday_hours: { enabled: true, open: '10:00', close: '12:00' },
    special_business_days: [{ date: '2026-10-04', open: '13:00', close: '15:00' }], // 日曜
    blocked_times: ['11:00'],
    required_choices: [1, 2],
    visible_choices: [1, 2],
  },
  ...overrides,
});

async function loadDom(config: SurveyConfig) {
  const html = new StaticSurveyGenerator().generateHTML(config, 'sv_test', 'st0001');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { html, w: dom.window as unknown as SurveyWindow, doc: dom.window.document };
}

describe('multiple-dates-settings（純粋ロジック）', () => {
  it('既定値は予約フォームの第三希望日時と同じ（日曜定休・30 分間隔・全て表示 / 必須）', () => {
    const d = createDefaultMultipleDatesSettings();
    expect(d.time_interval).toBe(30);
    expect(d.weekday_hours?.['0'].closed).toBe(true);
    expect(d.exclude_weekdays).toEqual([0]);
    expect(getVisibleChoices(d)).toEqual([1, 2, 3]);
    expect(getRequiredChoices(d)).toEqual([1, 2, 3]);
  });

  it('normalize: 欠損を補完し、不正値は既定値、第一希望は常に必須', () => {
    const n = normalizeMultipleDatesSettings({ time_interval: 7, required_choices: [3], visible_choices: [], blocked_times: ['9:00', 'x'], special_business_days: [{ date: '2026-10-04', open: '13:00', close: '15:00' }] });
    expect(n.time_interval).toBe(30);
    expect(n.required_choices).toEqual([1, 3]);
    expect(n.visible_choices).toEqual([1, 2, 3]);
    expect(n.blocked_times).toEqual(['9:00']);
    expect(n.special_business_days).toEqual([{ date: '2026-10-04', open: '13:00', close: '15:00' }]);
    expect(Object.keys(n.weekday_hours || {})).toHaveLength(7);
  });

  it('normalize: レガシー exclude_weekdays + start/end から曜日別を組み立てる', () => {
    const n = normalizeMultipleDatesSettings({ exclude_weekdays: [0, 6], start_time: '10:00', end_time: '17:00' });
    expect(n.weekday_hours?.['6']).toMatchObject({ open: '10:00', close: '17:00', closed: true });
    expect(n.weekday_hours?.['1']).toMatchObject({ open: '10:00', close: '17:00', closed: false });
    expect(n.exclude_weekdays).toEqual([0, 6]);
  });
});

describe('アンケート: 質問型「第三希望日時選択」', { timeout: 20000 }, () => {
  it('生成 HTML に共通ランタイムと第一・第二希望の選択欄（第三は非表示）が入る', async () => {
    const { html, doc } = await loadDom(makeConfig(mdQuestion()));
    expect(html).toContain('function getEffectiveHolidayType(');
    expect(html).toContain('function mdPopulateDateOptions(');
    expect(html).toContain('function collectMultipleDatesAnswer(');
    expect(doc.getElementById('q1_1_day')).not.toBeNull();
    expect(doc.getElementById('q1_2_day')).not.toBeNull();
    expect(doc.getElementById('q1_3_day')).toBeNull();
    // 必須の希望には「必須」、それ以外は「（任意）」
    expect(doc.getElementById('q1_choice_1')?.textContent).toContain('必須');
    expect(doc.getElementById('q1_choice_2')?.textContent).toContain('必須');
  });

  it('日付の選択肢は定休曜日を除き、臨時営業日の日曜は含まれる', async () => {
    const { w, doc } = await loadDom(makeConfig(mdQuestion()));
    const settings = normalizedQuestion().multiple_dates;
    // 2026-10-04（日）は臨時営業日 → 選べる。2026-10-11（日）は定休 → 選べない
    expect(w.mdIsDateSelectable(settings, new Date('2026-10-04T00:00:00'))).toBe(true);
    expect(w.mdIsDateSelectable(settings, new Date('2026-10-11T00:00:00'))).toBe(false);
    // 祝日（2026-10-12 スポーツの日・月曜）は祝日設定の 10:00〜12:00
    expect(w.getEffectiveHolidayType(new Date('2026-10-12T00:00:00'))).toBe('sports');
    expect(w.mdGetWeekdayHours(settings, 1, new Date('2026-10-12T00:00:00'))).toMatchObject({ open: '10:00', close: '12:00', closed: false });
    // 初期描画で日付の選択肢が作られている（「日付を選択」+ 営業日）
    const daySelect = doc.getElementById('q1_1_day') as HTMLSelectElement;
    expect(daySelect.options.length).toBeGreaterThan(1);
    expect(Array.from(daySelect.options).every((o) => !o.value || !/^\d{4}-\d{2}-\d{2}$/.test(o.value) || w.mdIsDateSelectable(settings, new Date(o.value + 'T00:00:00')))).toBe(true);
  });

  it('時間の選択肢: 曜日別の受付時間 + 追加の時間帯、✕にする時間帯を除外。臨時営業日はその時間', async () => {
    const { w, doc } = await loadDom(makeConfig(mdQuestion()));
    const settings = normalizedQuestion().multiple_dates;
    const select = doc.getElementById('q1_1_time') as HTMLSelectElement;
    w.mdPopulateTimeOptions(select, settings, '2026-10-05'); // 月曜 09:00〜12:00、11:00 は✕、先頭に「午前中」
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '午前中', '09:00', '10:00']);
    w.mdPopulateTimeOptions(select, settings, '2026-10-04'); // 臨時営業日（日曜）13:00〜15:00
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '13:00', '14:00']);
  });

  it('送信値: 必須の希望が未選択ならエラー、選択済みなら「第一希望: … / 第二希望: …」', async () => {
    const { w, doc } = await loadDom(makeConfig(mdQuestion()));
    const q = normalizedQuestion();
    const settings = q.multiple_dates;
    expect(w.collectMultipleDatesAnswer(q)).toEqual({ error: 'ご希望の日時の第一希望日時を選択してください。', value: '' });

    const set = (idx: number, date: string, time: string) => {
      const day = doc.getElementById(`q1_${idx}_day`) as HTMLSelectElement;
      const opt = doc.createElement('option'); opt.value = date; opt.textContent = date; day.appendChild(opt);
      day.value = date;
      const t = doc.getElementById(`q1_${idx}_time`) as HTMLSelectElement;
      w.mdPopulateTimeOptions(t, settings, date);
      t.value = time;
    };
    set(1, '2026-10-05', '10:00');
    expect(w.collectMultipleDatesAnswer(q)).toEqual({ error: 'ご希望の日時の第二希望日時を選択してください。', value: '' });
    set(2, '2026-10-04', '13:00');
    expect(w.collectMultipleDatesAnswer(q)).toEqual({ error: null, value: '第一希望: 2026年10月05日（月） 10:00 / 第二希望: 2026年10月04日（日） 13:00' });
  });

  it('必須項目でなければ未選択でもエラーにならない', async () => {
    const { w } = await loadDom(makeConfig(mdQuestion({ required: false })));
    expect(w.collectMultipleDatesAnswer(normalizedQuestion({ required: false }))).toEqual({ error: null, value: '' });
  });
});
